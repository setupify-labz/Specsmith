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

// Same underlying check as isGalleryEnabled (same client, same env vars) —
// named separately for AuthContext.tsx so each feature's "is this
// configured" flag reads clearly at its own call sites, without renaming
// the gallery's existing export.
export const isSupabaseConfigured = supabase !== null;

export interface ProfileRow {
  id: string;
  username: string;
  avatar: string | null;
  preferred_resolution: string;
  preferred_preset: string;
  created_at: string;
}

export interface SavedBuildRow {
  id: string;
  user_id: string;
  name: string;
  notes: string;
  build_state: Record<string, string | null>;
  shared_count: number;
  created_at: string;
  updated_at: string;
}

export interface PublicBuildRow {
  id: string;
  name: string;
  build_state: Record<string, string | null>;
  creator_name: string;
  total_cost: number;
  avg_fps: number;
  view_count: number;
  is_staff_pick: boolean;
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
