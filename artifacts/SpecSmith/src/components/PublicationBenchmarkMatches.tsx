import { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import {
  formatPublicationResolution,
  getPublicationBenchmarksForBuild,
  publicationLowMetricLabel,
  type PublicationBenchmarkRecord,
} from '../lib/publicationBenchmarks';

interface Props {
  gpuId: string;
  gpuName: string;
  cpuId: string;
  cpuName: string;
}

const INITIAL_VISIBLE = 6;

function PublicationRecordCard({ record }: { record: PublicationBenchmarkRecord }) {
  const featureBits = [
    record.rayTracing === true ? 'Ray tracing on' : null,
    record.rayTracing === false ? 'Ray tracing off' : null,
    record.upscaler ? `${record.upscaler.toUpperCase()}${record.upscalerMode ? ` ${record.upscalerMode}` : ''}` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-bold" style={{ color: 'var(--ff-text)' }}>{record.gameName}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ff-text-2)' }}>
            {formatPublicationResolution(record)} · {record.gpuName} + {record.cpuName}
          </div>
        </div>
        <span
          className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full"
          style={{ color: 'var(--ff-accent-text)', backgroundColor: 'rgba(108, 99, 255, 0.10)', border: '1px solid rgba(108, 99, 255, 0.30)' }}
        >
          Publication measured
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--ff-surface)' }}>
          <div className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{Math.round(record.averageFps)}</div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>Avg FPS</div>
        </div>
        {record.lowFps != null && (
          <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--ff-surface)' }}>
            <div className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{Math.round(record.lowFps)}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>
              {publicationLowMetricLabel(record.lowMetric)}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed mb-2" style={{ color: 'var(--ff-text-2)' }}>
        {record.settingsSummary}
      </p>

      {featureBits.length > 0 && (
        <p className="text-[11px] mb-2" style={{ color: 'var(--ff-cyan)' }}>{featureBits.join(' · ')}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--ff-text-3)' }}>
        <span>Third-party publication test — not a SpecSmith lab test.</span>
        <a
          href={record.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:opacity-80"
          style={{ color: 'var(--ff-accent-text)' }}
          title={record.source.title}
        >
          {record.source.publisher} <ExternalLink size={10} />
        </a>
        <span>Evidence quality {record.evidenceQuality}</span>
      </div>
    </div>
  );
}

export default function PublicationBenchmarkMatches({ gpuId, gpuName, cpuId, cpuName }: Props) {
  const records = getPublicationBenchmarksForBuild(gpuId, cpuId);
  const [showAll, setShowAll] = useState(false);

  if (records.length === 0) return null;
  const visible = showAll ? records : records.slice(0, INITIAL_VISIBLE);

  return (
    <section
      className="rounded-2xl p-6 mt-6"
      style={{ border: '1px solid rgba(108, 99, 255, 0.35)', backgroundColor: 'var(--ff-surface)' }}
      aria-label="Publication measured benchmarks"
    >
      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={18} style={{ color: 'var(--ff-accent-text)' }} />
        <h3 className="font-bold text-lg" style={{ color: 'var(--ff-text)' }}>Publication Measured</h3>
        <span className="text-xs font-normal" style={{ color: 'var(--ff-text-2)' }}>— {gpuName} + {cpuName}</span>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>
        Real FPS results reported by hardware publications for this exact CPU + GPU pair. These stay separate from
        SpecSmith-controlled measurements when the source does not expose every normalized setting.
      </p>

      <div className="space-y-3">
        {visible.map((record) => <PublicationRecordCard key={record.id} record={record} />)}
      </div>

      {records.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-3 text-xs font-semibold hover:opacity-80"
          style={{ color: 'var(--ff-accent-text)' }}
        >
          {showAll ? 'Show fewer' : `Show all ${records.length} publication results`}
        </button>
      )}
    </section>
  );
}
