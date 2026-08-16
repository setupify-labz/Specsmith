import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { getVerifiedGames, lookupVerifiedFps, type VerifiedFpsQuery } from '../lib/benchmarks/lookup';
import type { Resolution, Preset, Upscaler } from '../lib/benchmarks/types';

interface Props {
  gpuId: string;
  gpuName: string;
  cpuId: string;
  cpuName: string;
}

const resolutions: Resolution[] = ['1080p', '1440p', '4k'];
const presets: Preset[] = ['low', 'medium', 'high', 'ultra'];
const resLabels: Record<Resolution, string> = { '1080p': '1080p', '1440p': '1440p', '4k': '4K' };
const presetLabels: Record<Preset, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

export default function VerifiedBenchmarkPanel({ gpuId, gpuName, cpuId, cpuName }: Props) {
  const games = getVerifiedGames();
  const [gameId, setGameId] = useState(games[0]?.gameId ?? '');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [preset, setPreset] = useState<Preset>('ultra');
  const [rayTracing, setRayTracing] = useState(false);
  const [upscaler, setUpscaler] = useState<Upscaler>('native');
  const [frameGeneration, setFrameGeneration] = useState(false);

  const profile = games.find((g) => g.gameId === gameId);

  const query: VerifiedFpsQuery = useMemo(
    () => ({ gameId, cpuId, gpuId, resolution, preset, rayTracing, upscaler, frameGeneration }),
    [gameId, cpuId, gpuId, resolution, preset, rayTracing, upscaler, frameGeneration],
  );

  const result = lookupVerifiedFps(query);

  const toggleStyle = (active: boolean) => active
    ? { backgroundColor: 'var(--ff-accent-solid)', color: '#fff' }
    : { color: 'var(--ff-text-2)', backgroundColor: 'transparent' };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-6 mt-6"
      style={{ border: '1px solid var(--ff-green)', backgroundColor: 'var(--ff-surface)' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={18} style={{ color: 'var(--ff-green)' }} />
        <h3 className="font-bold text-lg" style={{ color: 'var(--ff-text)' }}>Verified Benchmarks</h3>
        <span className="text-xs font-normal" style={{ color: 'var(--ff-text-2)' }}>— {gpuName} + {cpuName}</span>
      </div>
      <p className="text-xs mb-5" style={{ color: 'var(--ff-text-3)' }}>
        Every number here traces to a real, cited benchmark. No formula, no guessing — if we don't have a measured
        result for your exact configuration, we say so instead of estimating one.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label htmlFor="verified-game-select" className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Game</label>
          <select
            id="verified-game-select"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
          >
            {games.map((g) => <option key={g.gameId} value={g.gameId}>{g.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Resolution</label>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--ff-border)' }}>
            {resolutions.map((r) => (
              <button key={r} onClick={() => setResolution(r)} className="flex-1 py-2 text-xs font-semibold transition-colors" style={toggleStyle(resolution === r)}>
                {resLabels[r]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: 'var(--ff-text-2)' }}>Quality</label>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--ff-border)' }}>
            {presets.map((p) => (
              <button key={p} onClick={() => setPreset(p)} className="flex-1 py-2 text-xs font-semibold transition-colors" style={toggleStyle(preset === p)}>
                {presetLabels[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feature toggles — only shown if the game actually supports them */}
      <div className="flex flex-wrap gap-2 mb-5">
        {profile?.rayTracing.status !== 'unsupported' && (
          <button onClick={() => setRayTracing(!rayTracing)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={toggleStyle(rayTracing)}>
            Ray Tracing {rayTracing ? 'On' : 'Off'}
          </button>
        )}
        {(['dlss', 'fsr', 'xess'] as const).map((u) => (
          profile?.[u].status !== 'unsupported' && (
            <button key={u} onClick={() => setUpscaler(upscaler === u ? 'native' : u)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors uppercase"
              style={toggleStyle(upscaler === u)}>
              {u}
            </button>
          )
        ))}
        {profile?.frameGeneration.status !== 'unsupported' && (
          <button onClick={() => setFrameGeneration(!frameGeneration)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={toggleStyle(frameGeneration)}>
            Frame Gen {frameGeneration ? 'On' : 'Off'}
          </button>
        )}
      </div>

      {/* Result */}
      {result.state === 'MEASURED' && result.record && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-green)' }}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} style={{ color: 'var(--ff-green)' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ff-green)' }}>Measured</span>
          </div>
          <p className="text-3xl font-black" style={{ color: 'var(--ff-text)' }}>
            {result.record.averageFps} <span className="text-sm font-normal" style={{ color: 'var(--ff-text-2)' }}>FPS average</span>
          </p>
          {result.record.frameGeneration && (
            <p className="text-xs mt-1" style={{ color: 'var(--ff-amber)' }}>
              Frame Generation is on — this is the displayed FPS, not independently rendered frames.
            </p>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--ff-text-2)' }}>
            Source:{' '}
            <a href={result.record.source.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              {result.record.source.publisher} <ExternalLink size={10} />
            </a>
            {' · Evidence quality ' + result.record.evidenceQuality}
          </p>
        </div>
      )}

      {result.state === 'UNSUPPORTED' && (
        <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}>
          <span style={{ color: 'var(--ff-text)' }} className="font-semibold">Not supported: </span>
          {result.featureNote}
        </div>
      )}

      {result.state === 'CONDITIONAL' && (
        <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}>
          <span style={{ color: 'var(--ff-amber)' }} className="font-semibold">Conditional: </span>
          {result.featureNote}
        </div>
      )}

      {result.state === 'NOT_AVAILABLE' && (
        <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}>
          No verified benchmark available for this exact configuration yet.
        </div>
      )}
    </motion.div>
  );
}
