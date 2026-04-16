import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { calculatePoints } from '@/lib/scoring';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST — player submits an answer
export async function POST(request, { params }) {
  const { code } = params;
  const { player_id, question_index, selected_option } = await request.json();

  // Fetch room
  const { data: room } = await db
    .from('game_rooms')
    .select('*')
    .eq('join_code', code.toUpperCase())
    .single();

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (room.status !== 'playing') return NextResponse.json({ error: 'Game not active' }, { status: 400 });

  const question = room.questions?.[question_index];
  if (!question) return NextResponse.json({ error: 'Invalid question' }, { status: 400 });

  // Compute time and score server-side
  const now = Date.now();
  const started = new Date(room.question_started_at).getTime();
  const timeTakenMs = Math.max(0, now - started);
  const isCorrect = selected_option === question.correct_index;
  const points = calculatePoints(isCorrect, timeTakenMs);

  // Insert answer
  const { error: ansErr } = await db
    .from('game_answers')
    .insert({
      room_id: room.id,
      player_id,
      question_index,
      selected_option,
      is_correct: isCorrect,
      time_taken_ms: timeTakenMs,
      points_awarded: points,
    });

  if (ansErr) {
    if (ansErr.code === '23505') return NextResponse.json({ error: 'Already answered' }, { status: 409 });
    return NextResponse.json({ error: ansErr.message }, { status: 500 });
  }

  // Update player's total score
  const { data: player } = await db
    .from('game_players')
    .select('total_score')
    .eq('id', player_id)
    .single();

  await db
    .from('game_players')
    .update({ total_score: (player?.total_score || 0) + points })
    .eq('id', player_id);

  return NextResponse.json({ is_correct: isCorrect, points, time_taken_ms: timeTakenMs });
}
