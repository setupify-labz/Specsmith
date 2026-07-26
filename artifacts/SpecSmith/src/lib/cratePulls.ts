import { supabase, type CratePullRow } from './supabase';
import type { CrateBuild } from './buildCrate';

/** Fire-and-forget: records a finished crate run to the global feed. Never
 * throws or blocks the UI — if Supabase isn't configured yet (see
 * supabase.ts) this silently no-ops, same as the rest of the Gallery
 * feature does before its project is set up. */
export async function recordGlobalPull(build: CrateBuild, pullerName: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('crate_pulls').insert({
      rarity: build.rarity,
      gpu_name: build.gpu.name,
      cpu_name: build.cpu.name,
      build_state: build.buildState,
      total_cost: build.totalCost,
      avg_fps: build.avgFps,
      puller_name: pullerName.slice(0, 40),
    });
  } catch {
    // Best-effort only — a failed write here should never interrupt the
    // reveal the visitor is already looking at.
  }
}

/** Recent Epic+ pulls across all visitors, newest first — the "wall of good
 * pulls" that makes the crate feel alive instead of a solo mechanic. */
export async function fetchRecentTopPulls(limit = 12): Promise<CratePullRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('crate_pulls')
    .select('*')
    .in('rarity', ['epic', 'legendary'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as CratePullRow[];
}
