-- =============================================================================
-- Migration: 002_create_multiplayer_tables
-- Description: Tables for Kahoot-style multiplayer mode
-- =============================================================================

-- Game rooms
create table if not exists game_rooms (
  id                     uuid primary key default uuid_generate_v4(),
  join_code              text not null unique,
  host_id                uuid,
  coordinate_hash        text not null,
  center_lat             double precision not null,
  center_lng             double precision not null,
  address                text not null,
  status                 text not null default 'lobby',
  current_question_index integer default -1,
  question_started_at    timestamptz,
  questions              jsonb,
  max_players            integer not null default 8,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_game_rooms_join_code on game_rooms (join_code);

-- Players in a room
create table if not exists game_players (
  id           uuid primary key default uuid_generate_v4(),
  room_id      uuid not null references game_rooms(id) on delete cascade,
  nickname     text not null,
  avatar_color text not null default '#667eea',
  is_host      boolean not null default false,
  total_score  integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_game_players_room on game_players (room_id);

-- Per-question answers
create table if not exists game_answers (
  id              uuid primary key default uuid_generate_v4(),
  room_id         uuid not null references game_rooms(id) on delete cascade,
  player_id       uuid not null references game_players(id) on delete cascade,
  question_index  integer not null,
  selected_option integer not null,
  is_correct      boolean not null,
  time_taken_ms   integer not null,
  points_awarded  integer not null default 0,
  created_at      timestamptz not null default now(),

  unique(room_id, player_id, question_index)
);

create index if not exists idx_game_answers_room_question on game_answers (room_id, question_index);

-- RLS — open read/write for anonymous family game
alter table game_rooms enable row level security;
alter table game_players enable row level security;
alter table game_answers enable row level security;

create policy "Public access game_rooms" on game_rooms for all using (true) with check (true);
create policy "Public access game_players" on game_players for all using (true) with check (true);
create policy "Public access game_answers" on game_answers for all using (true) with check (true);

-- Auto-update timestamp on game_rooms
create trigger set_game_rooms_updated_at
  before update on game_rooms
  for each row
  execute function update_updated_at_column();
