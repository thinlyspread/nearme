-- =============================================================================
-- Migration: 001_create_location_library
-- Description: Core location cache table for NearMe game
-- Replaces: Airtable `location_library` table
-- Run this in: Supabase Dashboard > SQL Editor
-- =============================================================================

-- Enable UUID extension (usually already enabled on Supabase)
create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
-- TABLE: location_library
-- Stores validated Street View locations used to generate quiz questions.
-- Locations are cached by coordinate_hash to avoid redundant API calls.
-- -----------------------------------------------------------------------------
create table if not exists location_library (

  -- Primary key (auto UUID, replaces Airtable's opaque record IDs)
  id                uuid primary key default uuid_generate_v4(),

  -- Cache key: "lat_lng_radius" rounded to 4dp e.g. "50.8547_-0.4010_500"
  -- Used to look up existing locations for a given address + radius
  coordinate_hash   text not null,

  -- Human-readable street name e.g. "Findon Road"
  location_name     text not null,

  -- GPS coordinates of the Street View point
  latitude          double precision not null,
  longitude         double precision not null,

  -- Google Street View static image URL (includes API key at generation time)
  image_url         text not null,

  -- Cloud Vision quality score (0-10)
  -- Tier 1 distinctive features = 10, Tier 2 scored by count, 0 = rejected
  quality_score     integer not null default 0,

  -- Comma-separated labels returned by Cloud Vision API
  vision_labels     text,

  -- Quality gate flag: 'good' | 'bad' | 'needs_review'
  quality_flag      text not null default 'good',

  -- Reserved for future use: how recognisable is this location (0-10)
  familiarity_score integer not null default 5,

  -- How many times this location has appeared in a quiz
  times_used        integer not null default 0,

  -- Source type tag e.g. 'random_street_view'
  types             text not null default 'random_street_view',

  -- Timestamps (auto-managed)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()

);

-- -----------------------------------------------------------------------------
-- INDEXES
-- coordinate_hash is the primary lookup pattern (cache check on game start)
-- -----------------------------------------------------------------------------
create index if not exists idx_location_library_hash
  on location_library (coordinate_hash);

create index if not exists idx_location_library_quality
  on location_library (quality_score, quality_flag);

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Anon users can READ locations (needed for game to work client-side)
-- Only the service role (server/edge function) can INSERT/UPDATE
-- -----------------------------------------------------------------------------
alter table location_library enable row level security;

-- Allow anyone (including anon) to read cached locations
create policy "Public read access"
  on location_library for select
  using (true);

-- Only authenticated service role can write (insert new locations)
-- This prevents abuse of the anon key to spam the DB
create policy "Service role insert"
  on location_library for insert
  with check (auth.role() = 'service_role');

create policy "Service role update"
  on location_library for update
  using (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- AUTO-UPDATE updated_at TRIGGER
-- -----------------------------------------------------------------------------
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on location_library
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- Done. Verify with:
-- select column_name, data_type from information_schema.columns
-- where table_name = 'location_library';
-- =============================================================================
