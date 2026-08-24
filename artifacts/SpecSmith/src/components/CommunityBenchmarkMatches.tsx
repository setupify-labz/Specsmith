import { AlertTriangle, ExternalLink, Users } from 'lucide-react';
import {
  formatCommunityResolution,
  getCommunityBenchmarksForBuild,
  type CommunityBenchmarkRecord,
} from '../lib/communityBenchmarks';

interface Props {
  gpuId: string;
  gpuName: string;
  cpuId: string;
  cpuName: string;
}

const flagLabels: Record<string, string> = {
  cpu_limited_session: 'CPU-limited session',
  large_avg_to_1pct_gap: 'Large average-to-1% low gap',
  source_fps_limit_inconsistency: 'Source FPS-limit inconsistency',
  single_channel_ram: 'Single-channel RAM reported',
  outdated_driver_reported: 'Older driver reported',
  xmp_disabled_reported: 'XMP disabled reported',
};

function metric(label: string, value: number | undefined) {
  if (value == null) return null;
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--ff-card)' }}>
      <div className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>{Math.round(value)}</div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>{label}</div>
    </div>
  );
}

function CommunityRecordCard({ record }: { record: CommunityBenchmarkRecord }) {
  const settings = Object.entries(record.observedSettings);
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-bold" style={{ color: 'var(--ff-text)' }}>{record.gameName}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ff-text-2)' }}>
            {formatCommunityResolution(record)} · {record.gpuName} + {record.cpuName}
          </div>
        </div>
        <span
          className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full"
          style={{ color: 'var(--ff-cyan)', backgroundColor: 'rgba(0, 212, 255, 0.08)', border: '1px solid rgba(0, 212, 255, 0.25)' }}
        >
          Community measured
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {metric('Avg FPS', record.averageFps)}
        {metric('1% Low', record.onePercentLow)}
        {metric('0.1% Low', record.zeroPointOnePercentLow)}
        {metric('Max FPS', record.maxFps)}
      </div>

      {settings.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--ff-text-3)' }}>
            Settings exposed by source
          </div>
          <div className="flex flex-wrap gap-1.5">
            {settings.map(([key, value]) => (
              <span key={key} className="text-[11px] px-2 py-1 rounded-md" style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-surface)' }}>
                <strong style={{ color: 'var(--ff-text)' }}>{key}:</strong> {value}
              </span>
            ))}
          </div>
          {record.settingsCompleteness === 'partial' && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--ff-text-3)' }}>
              Partial settings only. SpecSmith does not infer a Low/High/Ultra preset or missing RT/upscaler/frame-generation state.
            </p>
          )}
        </div>
      )}

      {record.qualityFlags.length > 0 && (
        <div className="flex items-start gap-2 mb-3 text-[11px]" style={{ color: 'var(--ff-amber)' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{record.qualityFlags.map((flag) => flagLabels[flag] ?? flag.replaceAll('_', ' ')).join(' · ')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--ff-text-3)' }}>
        <span>Third-party gameplay session — not a SpecSmith lab test.</span>
        <a
          href={record.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:opacity-80"
          style={{ color: 'var(--ff-accent-text)' }}
        >
          Source: {record.source.publisher} <ExternalLink size={10} />
        </a>
        <a
          href={record.source.licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80"
          style={{ color: 'var(--ff-text-2)' }}
        >
          {record.source.license}
        </a>
      </div>
    </div>
  );
}

export default function CommunityBenchmarkMatches({ gpuId, gpuName, cpuId, cpuName }: Props) {
  const records = getCommunityBenchmarksForBuild(gpuId, cpuId);
  if (records.length === 0) return null;

  return (
    <section
      className="rounded-2xl p-6 mt-6"
      style={{ border: '1px solid rgba(0, 212, 255, 0.35)', backgroundColor: 'var(--ff-surface)' }}
      aria-label="Community measured benchmarks"
    >
      <div className="flex items-center gap-2 mb-1">
        <Users size={18} style={{ color: 'var(--ff-cyan)' }} />
        <h3 className="font-bold text-lg" style={{ color: 'var(--ff-text)' }}>Community Measured</h3>
        <span className="text-xs font-normal" style={{ color: 'var(--ff-text-2)' }}>— {gpuName} + {cpuName}</span>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>
        Real third-party gameplay sessions for this exact CPU + GPU pair. These are separate from SpecSmith-controlled and strictly normalized verified benchmarks because community systems, scenes, drivers, RAM, and settings can vary.
      </p>

      <div className="space-y-3">
        {records.map((record) => <CommunityRecordCard key={record.id} record={record} />)}
      </div>
    </section>
  );
}
