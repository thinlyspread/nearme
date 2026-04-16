import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../../../rate-limit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const COLORS = ['#667eea','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#3498db'];

// POST — join an existing room
export async function POST(request, { params }) {
  if (!rateLimit(request, { limit: 20, windowMs: 60000 })) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const { code } = params;
  const { nickname } = await request.json();

  if (!nickname || nickname.trim().length < 1 || nickname.trim().length > 12) {
    return NextResponse.json({ error: 'Nickname must be 1-12 characters' }, { status: 400 });
  }

  // Find room
  const { data: room } = await db
    .from('game_rooms')
    .select('*')
    .eq('join_code', code.toUpperCase())
    .single();

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (room.status !== 'lobby') return NextResponse.json({ error: 'Game already started' }, { status: 400 });

  // Check player count
  const { data: players } = await db
    .from('game_players')
    .select('id, nickname')
    .eq('room_id', room.id);

  if (players.length >= room.max_players) {
    return NextResponse.json({ error: 'Room is full' }, { status: 400 });
  }

  if (players.some(p => p.nickname.toLowerCase() === nickname.trim().toLowerCase())) {
    return NextResponse.json({ error: 'Nickname already taken' }, { status: 400 });
  }

  const avatarColor = COLORS[players.length % COLORS.length];

  const { data: player, error } = await db
    .from('game_players')
    .insert({
      room_id: room.id,
      nickname: nickname.trim(),
      avatar_color: avatarColor,
      is_host: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    player_id: player.id,
    room_id: room.id,
    avatar_color: avatarColor,
    address: room.address,
  });
}
