import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET — fetch room + players by join code
export async function GET(request, { params }) {
  const { code } = params;

  const { data: room, error } = await db
    .from('game_rooms')
    .select('*')
    .eq('join_code', code.toUpperCase())
    .single();

  if (error || !room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const { data: players } = await db
    .from('game_players')
    .select('*')
    .eq('room_id', room.id)
    .order('created_at');

  return NextResponse.json({ room, players: players || [] });
}
