import { useSeo } from '../hooks/useSeo';
import { getCoverageSummary, getAllBenchmarkRecords } from '../lib/benchmarks/lookup';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';

const fallbackMeta = {
  path: '/admin/benchmarks',
  title: 'Benchmark Coverage — Internal | SpecSmith',
  description: 'Internal dashboard tracking verified benchmark record coverage.',
  noindex: true,
};

const gpuNames = new Map((gpuData as { id: string; name: string }[]).map((g) => [g.id, g.name]));
const cpuNames = new Map((cpuData as { id: string; name: string }[]).map((c) => [c.id, c.name]));

export default function AdminBenchmarks() {
  useSeo(fallbackMeta);
  const summary = getCoverageSummary();
  const records = getAllBenchmarkRecords();

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <h1 className="text-2xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>Verified Benchmark Coverage</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--ff-text-2)' }}>
          Internal tracking page — not linked from the site, excluded from search engines.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Verified Records', value: summary.totalRecords },
            { label: 'Games Covered', value: summary.games.filter((g) => g.recordCount > 0).length },
            { label: 'CPUs Covered', value: summary.cpus.length },
            { label: 'GPUs Covered', value: summary.gpus.length },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <p className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{s.value}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ff-text-2)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-4 mb-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Games — coverage</h2>
          <div className="space-y-1">
            {summary.games.map((g) => (
              <div key={g.id} className="flex items-center justify-between text-xs py-1" style={{ borderTop: '1px solid var(--ff-border)' }}>
                <span style={{ color: 'var(--ff-text)' }}>{g.name}</span>
                <span style={{ color: g.recordCount > 0 ? 'var(--ff-green)' : 'var(--ff-text-3)' }}>
                  {g.recordCount} record{g.recordCount === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-4 mb-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Sources</h2>
          <div className="space-y-2">
            {summary.sources.map((s) => (
              <div key={s.url} className="text-xs">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                  {s.publisher}
                </a>
                <span style={{ color: 'var(--ff-text-3)' }}> — {s.recordCount} record{s.recordCount === 1 ? '' : 's'}</span>
              </div>
            ))}
            {summary.sources.length === 0 && <p className="text-xs" style={{ color: 'var(--ff-text-3)' }}>No sources yet.</p>}
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>All verified records</h2>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Verified benchmark records table">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--ff-text-2)' }}>
                  <th className="text-left py-1 pr-3">CPU + GPU</th>
                  <th className="text-left py-1 pr-3">Settings</th>
                  <th className="text-right py-1 pr-3">FPS</th>
                  <th className="text-left py-1">Quality / Source</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
                    <td className="py-1.5 pr-3">{cpuNames.get(r.cpuId) ?? r.cpuId} + {gpuNames.get(r.gpuId) ?? r.gpuId}</td>
                    <td className="py-1.5 pr-3">
                      {r.resolution} {r.preset}
                      {r.frameGeneration ? ' · FG' : ''}
                      {r.rayTracing ? ' · RT' : ''}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-bold">{r.averageFps}</td>
                    <td className="py-1.5">
                      <span style={{ color: 'var(--ff-amber)' }}>{r.evidenceQuality}</span>{' '}
                      <a href={r.source.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                        {r.source.publisher}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
