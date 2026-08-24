import { useSeo } from '../hooks/useSeo';
import { getCoverageSummary, getAllBenchmarkRecords, getVerifiedGames } from '../lib/benchmarks/lookup';
import { validateAllBenchmarkRecords, validateGameFeatureProfiles } from '../lib/benchmarks/validate';
import { REQUIRED_PROVENANCE_FIELDS } from '../lib/benchmarks/types';
import { getCommunityBenchmarkRecords, validateCommunityBenchmarkRecords } from '../lib/communityBenchmarks';
import { getPublicationBenchmarkRecords, validatePublicationBenchmarkRecords } from '../lib/publicationBenchmarks';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import measuredObservationsData from '../data/measuredObservations.json';

const fallbackMeta = {
  path: '/admin/benchmarks',
  title: 'Benchmark Coverage — Internal | SpecSmith',
  description: 'Internal dashboard tracking benchmark evidence coverage.',
  noindex: true,
};

const gpuNames = new Map((gpuData as { id: string; name: string }[]).map((g) => [g.id, g.name]));
const cpuNames = new Map((cpuData as { id: string; name: string }[]).map((c) => [c.id, c.name]));

export default function AdminBenchmarks() {
  useSeo(fallbackMeta);
  const summary = getCoverageSummary();
  const records = getAllBenchmarkRecords();
  const publicationRecords = getPublicationBenchmarkRecords();
  const communityRecords = getCommunityBenchmarkRecords();
  const specsmithMeasuredCount = measuredObservationsData.observations.length;
  const sourceCommunityTotal = records.length + publicationRecords.length + communityRecords.length;

  const knownGpuIds = new Set(gpuData.map((g) => g.id));
  const knownCpuIds = new Set(cpuData.map((c) => c.id));
  const knownVerifiedGameIds = new Set(getVerifiedGames().map((p) => p.gameId));
  const dataIssues = [
    ...validateAllBenchmarkRecords(records, knownGpuIds, knownCpuIds, knownVerifiedGameIds),
    ...validateGameFeatureProfiles(getVerifiedGames()),
    ...validatePublicationBenchmarkRecords(publicationRecords)
      .map((issue) => ({ recordId: issue.id, message: issue.message })),
    ...validateCommunityBenchmarkRecords(communityRecords)
      .map((issue) => ({ recordId: issue.id, message: issue.message })),
  ];

  const evidenceStats = [
    { label: 'Strict verified', value: records.length },
    { label: 'Publication measured', value: publicationRecords.length },
    { label: 'Community measured', value: communityRecords.length },
    { label: 'Source/community total', value: sourceCommunityTotal },
    { label: 'SpecSmith measured', value: specsmithMeasuredCount },
  ];

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <h1 className="text-2xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>Benchmark Data Coverage</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--ff-text-2)' }}>
          Internal tracking page — evidence tiers remain separate; estimates are not counted here.
        </p>

        <div
          className="rounded-xl p-4 mb-8"
          style={{ backgroundColor: 'var(--ff-surface)', border: `1px solid ${dataIssues.length > 0 ? 'var(--ff-red)' : 'var(--ff-green)'}` }}
        >
          <h2 className="font-bold text-sm mb-2" style={{ color: 'var(--ff-text)' }}>
            Data integrity: {dataIssues.length === 0 ? '✓ clean' : `${dataIssues.length} issue${dataIssues.length === 1 ? '' : 's'}`}
          </h2>
          {dataIssues.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>
              Strict verified, publication-measured, community-measured, and feature-profile validation all pass.
            </p>
          ) : (
            <ul className="space-y-1">
              {dataIssues.map((issue, i) => (
                <li key={`${issue.recordId}-${i}`} className="text-xs" style={{ color: 'var(--ff-text-2)' }}>
                  <span style={{ color: 'var(--ff-red)' }} className="font-semibold">{issue.recordId}</span>: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
          {evidenceStats.map((s) => (
            <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <p className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>{s.value}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ff-text-2)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-4 mb-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Strict verified coverage</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <p className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{summary.games.filter((g) => g.recordCount > 0).length} / {summary.estimatorCatalogSize.games}</p>
              <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>games vs estimator catalog</p>
            </div>
            <div>
              <p className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{summary.cpus.length} / {summary.estimatorCatalogSize.cpus}</p>
              <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>CPUs vs estimator catalog</p>
            </div>
            <div>
              <p className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{summary.gpus.length} / {summary.estimatorCatalogSize.gpus}</p>
              <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>GPUs vs estimator catalog</p>
            </div>
          </div>
        </div>

        {summary.gamesNotInEstimatorCatalog.length > 0 && (
          <div className="rounded-xl p-4 mb-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-amber)' }}>
            <h2 className="font-bold text-sm mb-2" style={{ color: 'var(--ff-text)' }}>Strict verified games outside the Estimator catalog</h2>
            <p className="text-xs" style={{ color: 'var(--ff-amber)' }}>{summary.gamesNotInEstimatorCatalog.join(', ')}</p>
          </div>
        )}

        <div className="rounded-xl p-4 mb-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Strict games — coverage</h2>
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
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Publication sources</h2>
          {[...new Map(publicationRecords.map((r) => [r.source.url, r.source])).values()].map((source) => {
            const count = publicationRecords.filter((r) => r.source.url === source.url).length;
            return (
              <div key={source.url} className="text-xs py-1">
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                  {source.publisher} — {source.title}
                </a>
                <span style={{ color: 'var(--ff-text-3)' }}> · {count} records</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>All strict verified records</h2>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Verified benchmark records table">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--ff-text-2)' }}>
                  <th className="text-left py-1 pr-3">CPU + GPU</th>
                  <th className="text-left py-1 pr-3">Settings</th>
                  <th className="text-right py-1 pr-3">FPS</th>
                  <th className="text-right py-1 pr-3">Fields confirmed</th>
                  <th className="text-left py-1 pr-3">Verified how</th>
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
                    <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ff-text-2)' }}>
                      {r.confirmedFields.length}/{REQUIRED_PROVENANCE_FIELDS.length}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span style={{ color: r.verificationMethod === 'direct-fetch' ? 'var(--ff-green)' : 'var(--ff-amber)' }}>
                        {r.verificationMethod === 'direct-fetch' ? 'Direct fetch' : 'Search summary'}
                      </span>
                    </td>
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
