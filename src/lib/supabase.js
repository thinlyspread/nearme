import { createClient } from '@supabase/supabase-js';

export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function fetchFromSupabase(hash) {
  const { data, error } = await db
    .from('location_library')
    .select('*')
    .eq('coordinate_hash', hash);
  if (error) { console.error('Supabase fetch error:', error); return []; }
  return data || [];
}

export async function saveToSupabase(locations) {
  const { data, error } = await db
    .from('location_library')
    .insert(locations)
    .select();
  if (error) throw new Error(`Database save failed: ${error.message}`);
  return data || [];
}
