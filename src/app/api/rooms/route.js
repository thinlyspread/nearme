import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../rate-limit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateJoinCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

const COLORS = ['#667eea','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#3498db'];

// POST — create a new game room
export async function POST(request) {
  if (!rateLimit(request, { limit: 10, windowMs: 60000 })) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const { lat, lng, address, nickname } = await request.json();
  if (!lat || !lng || !address || !nickname) {
    return NextResponse.json({ error: 'lat, lng, address, and nickname required' }, { status: 400 });
  }

  // Generate unique join code
  let joinCode;
  for (let i = 0; i < 10; i++) {
    joinCode = generateJoinCode();
    const { data } = await db.from('game_rooms').select('id').eq('join_code', joinCode).single();
    if (!data) break;
  }

  const coordinateHash = `${lat.toFixed(4)}_${lng.toFixed(4)}_500`;

  // Create room
  const { data: room, error: roomErr } = await db
    .from('game_rooms')
    .insert({
      join_code: joinCode,
      coordinate_hash: coordinateHash,
      center_lat: lat,
      center_lng: lng,
      address,
      status: 'lobby',
    })
    .select()
    .single();

  if (roomErr) return NextResponse.json({ error: roomErr.message }, { status: 500 });

  // Create host player
  const { data: player, error: playerErr } = await db
    .from('game_players')
    .insert({
      room_id: room.id,
      nickname,
      avatar_color: COLORS[0],
      is_host: true,
    })
    .select()
    .single();

  if (playerErr) return NextResponse.json({ error: playerErr.message }, { status: 500 });

  // Update room with host_id
  await db.from('game_rooms').update({ host_id: player.id }).eq('id', room.id);

  return NextResponse.json({ room_id: room.id, join_code: joinCode, player_id: player.id });
}
