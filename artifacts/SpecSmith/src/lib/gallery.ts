import { supabase, type PublicBuildRow } from './supabase';
import { estimateFpsForBuild, type BuildFpsGpu, type BuildFpsCpu } from './fps';
import { getPartPrice } from './prebuilts';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';

const gpus = gpuData as (BuildFpsGpu & { id: string })[];
const cpus = cpuData as (BuildFpsCpu & { id: string })[];
const games = gamesData as { id: string; name: string; gpu_bound?: number; base_fps: Record<string, Record<string, number>> }[];

const PART_CATEGORIES = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'monitor', 'keyboard', 'mouse', 'headset'];

export function computeBuildStats(buildState: Record<string, string | null>) {
  const gpu = gpus.find(g => g.id === buildState.gpu);
  const cpu = cpus.find(c => c.id === buildState.cpu);
  const totalCost = PART_CATEGORIES.reduce((sum, cat) => sum + getPartPrice(cat, buildState[cat] ?? ''), 0);
  const avgFps = gpu && cpu
    ? Math.round(games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, cpu, g, '1440p', 'high').estimated, 0) / games.length)
    : 0;
  return { totalCost, avgFps, hasGpuAndCpu: !!(gpu && cpu) };
}

export async function publishBuild(
  name: string,
  buildState: Record<string, string | null>,
  creatorName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Gallery is not set up yet.' };
  const { totalCost, avgFps } = computeBuildStats(buildState);
  const { error } = await supabase.from('public_builds').insert({
    name: name.slice(0, 60),
    build_state: buildState,
    creator_name: creatorName.slice(0, 40),
    total_cost: totalCost,
    avg_fps: avgFps,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchRecentBuilds(limit = 24): Promise<PublicBuildRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('public_builds')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as PublicBuildRow[];
}

export async function fetchTopBuilds(limit = 5): Promise<PublicBuildRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('public_builds')
    .select('*')
    .order('view_count', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as PublicBuildRow[];
}

export async function recordBuildView(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('increment_build_views', { build_id: id });
}
