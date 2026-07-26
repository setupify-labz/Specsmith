import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The gallery is the one feature on SpecSmith that needs data shared across
// visitors, which the rest of the site (all localStorage, see AuthContext)
// doesn't. These env vars are only set once someone has run the Supabase
// project + SQL script described in supabase-schema.sql — until then this
// stays null and gallery UI shows an "unavailable" state instead of crashing
// the build or the page.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export const isGalleryEnabled = supabase !== null;

export interface PublicBuildRow {
  id: string;
  name: string;
  build_state: Record<string, string | null>;
  creator_name: string;
  total_cost: number;
  avg_fps: number;
  view_count: number;
  created_at: string;
}

export interface CratePullRow {
  id: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  gpu_name: string;
  cpu_name: string;
  build_state: Record<string, string | null>;
  total_cost: number;
  avg_fps: number;
  puller_name: string;
  created_at: string;
}
