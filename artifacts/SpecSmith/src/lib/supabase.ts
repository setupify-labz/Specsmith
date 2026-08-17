import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Shared client for both Supabase-backed features: the public Gallery
// (anon-key read/write, no login) and real accounts (AuthContext.tsx —
// Supabase Auth + RLS-scoped profiles/saved_builds). These env vars are
// only set once someone has run the Supabase project + SQL script
// described in supabase-schema.sql — until then this stays null and each
// feature's UI shows an "unavailable" state instead of crashing the build
// or the page.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isBrowser = typeof window !== 'undefined';
const ssrMemoryStore = new Map<string, string>();

// Controls whether a login persists across browser restarts (localStorage)
// or only for the current tab (sessionStorage, cleared on close) — this is
// the "Remember me" checkbox on Login.tsx. supabase-js has no per-call
// option for this on signInWithPassword itself; the storage adapter is the
// only hook it exposes, so AuthContext.login flips this flag immediately
// before calling it. Defaults to true so every other write path (signup,
// token refresh, etc.) keeps today's always-persistent behavior.
let rememberSession = true;
export function setRememberSession(remember: boolean) {
  rememberSession = remember;
}

// Mirrors supabase-js's own SSR safety check (it falls back to an
// in-memory store when `window` doesn't exist) — a custom storage object
// has to redo that itself, since providing one opts out of the SDK's
// default detection.
const rememberAwareStorage = (url && anonKey) ? {
  getItem: (key: string) => {
    if (!isBrowser) return ssrMemoryStore.get(key) ?? null;
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (!isBrowser) { ssrMemoryStore.set(key, value); return; }
    if (rememberSession) {
      localStorage.setItem(key, value);
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
      localStorage.removeItem(key);
    }
  },
  removeItem: (key: string) => {
    if (!isBrowser) { ssrMemoryStore.delete(key); return; }
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
} : undefined;

export const supabase: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, { auth: { storage: rememberAwareStorage } })
  : null;

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
