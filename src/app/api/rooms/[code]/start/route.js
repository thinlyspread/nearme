import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST — host stores generated questions and starts the game
export async function POST(request, { params }) {
  const { code } = params;
  const { questions, player_id } = await request.json();

  const { data: room } = await db
    .from('game_rooms')
    .select('*')
    .eq('join_code', code.toUpperCase())
    .single();

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (room.host_id !== player_id) return NextResponse.json({ error: 'Only the host can start' }, { status: 403 });

  // Strip isCorrect from options before storing (players can read game_rooms)
  // Store correct indices separately
  const safeQuestions = questions.map(q => ({
    ...q,
    correct_index: q.options.findIndex(o => o.isCorrect),
    options: q.options.map(({ name, distance }) => ({ name, distance })),
  }));

  const { error } = await db
    .from('game_rooms')
    .update({
      questions: safeQuestions,
      status: 'playing',
      current_question_index: 0,
      question_started_at: new Date().toISOString(),
    })
    .eq('id', room.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
