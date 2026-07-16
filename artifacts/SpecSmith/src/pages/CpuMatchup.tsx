import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, ChevronRight, Trophy, DollarSign, Cpu, ExternalLink } from 'lucide-react';
import gamesData from '../data/games.json';
import { estimateFpsForBuild, getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import type { Resolution, Preset } from '../lib/fps';
import { getCpuMatchup, getMatchupCpuById, getMatchupFixedGpu, getCpuMatchupTitle, getRelatedCpuMatchups, buildVerdictParagraph, fpsPer100 } from '../lib/matchups';
import { useSeo } from '../hooks/useSeo';
import { getCpuMatchupMeta } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';

interface Game {
  id: string; name: string; genre: string;
  gpu_bound?: number;
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

const games = gamesData as Game[];
const COLORS = { a: '#6C63FF', b: '#00D4FF' };
const resolutions: Resolution[] = ['1080p', '1440p', '4k'];
const resLabels: Record<Resolution, string> = { '1080p': '1080p', '1440p': '1440p', '4k': '4K' };

export default function CpuMatchup() {
  const { slug } = useParams<{ slug: string }>();
  const matchup = slug ? getCpuMatchup(slug) : undefined;
  const cpuA = matchup ? getMatchupCpuById(matchup.cpuA) : undefined;
  const cpuB = matchup ? getMatchupCpuById(matchup.cpuB) : undefined;
  const gpu = getMatchupFixedGpu();

  // CPUs separate the most at 1080p, where the GPU isn't the bottleneck.
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const preset: Preset = 'high';

  const fallbackMeta = {
    path: '/vs',
    title: 'CPU Comparison Not Found | SpecSmith',
    description: 'This CPU comparison could not be found. Browse all SpecSmith head-to-head FPS comparisons instead.',
    noindex: true,
  };
  useSeo(matchup && cpuA && cpuB ? getCpuMatchupMeta(matchup) : fallbackMeta);

  const rows = useMemo(() => {
    if (!cpuA || !cpuB) return [];
    return games.map(g => {
      const fpsA = estimateFpsForBuild(gpu, cpuA, g, resolution, preset).estimated;
      const fpsB = estimateFpsForBuild(gpu, cpuB, g, resolution, preset).estimated;
      return { game: g.name, genre: g.genre, fpsA, fpsB };
    });
  }, [cpuA, cpuB, gpu, resolution]);

  if (!matchup || !cpuA || !cpuB) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Comparison not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>This CPU matchup doesn't exist.</p>
          <Link to="/vs" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse All Comparisons
          </Link>
        </div>
      </div>
    );
  }

  // Same >2% win margin as GPU pages — anything closer is inside this
  // estimator's error bars. Modern gaming CPUs genuinely tie in most
  // GPU-limited games, so a "Dead Heat" here is the honest answer, and
  // the recommendation falls through to price-per-frame value.
  const WIN_MARGIN = 1.02;
  const winsA = rows.filter(r => r.fpsA > r.fpsB * WIN_MARGIN).length;
  const winsB = rows.filter(r => r.fpsB > r.fpsA * WIN_MARGIN).length;
  const tooClose = rows.length - winsA - winsB;
  const avgAF = rows.reduce((s, r) => s + r.fpsA, 0) / rows.length;
  const avgBF = rows.reduce((s, r) => s + r.fpsB, 0) / rows.length;
  const fmtAvg = (v: number) => Math.abs(avgAF - avgBF) < 1 ? v.toFixed(1) : String(Math.round(v));
  const valueA = fpsPer100(avgAF, cpuA.price_usd);
  const valueB = fpsPer100(avgBF, cpuB.price_usd);
  const valueWinner = valueA >= valueB ? cpuA : cpuB;
  const isTie = winsA === winsB;
  const winner = winsA > winsB ? cpuA : cpuB;
  const recommended = isTie ? valueWinner : winner;

  const verdictText = buildVerdictParagraph({
    kind: 'CPU',
    nameA: cpuA.name, nameB: cpuB.name,
    priceA: cpuA.price_usd, priceB: cpuB.price_usd,
    winsA, winsB, total: rows.length,
    avgA: avgAF, avgB: avgBF,
    resolution: resLabels[resolution],
  });

  const specs: { label: string; a: string | number; b: string | number }[] = [
    { label: 'Price', a: `$${cpuA.price_usd}`, b: `$${cpuB.price_usd}` },
    { label: `FPS per $100 (${resLabels[resolution]} avg)`, a: valueA, b: valueB },
    { label: 'Cores / Threads', a: `${cpuA.cores} / ${cpuA.threads}`, b: `${cpuB.cores} / ${cpuB.threads}` },
    { label: 'Boost Clock', a: `${cpuA.boost_ghz} GHz`, b: `${cpuB.boost_ghz} GHz` },
    { label: 'TDP', a: `${cpuA.tdp_watts} W`, b: `${cpuB.tdp_watts} W` },
    { label: 'Socket', a: cpuA.socket, b: cpuB.socket },
    { label: 'Release Year', a: cpuA.release_year, b: cpuB.release_year },
    { label: 'Benchmark Score', a: cpuA.benchmark_score, b: cpuB.benchmark_score },
  ];

  const related = getRelatedCpuMatchups(matchup);

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Link to="/vs" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All Comparisons
        </Link>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            <span style={{ color: COLORS.a }}>{cpuA.name}</span>
            <span className="mx-3" style={{ color: 'var(--ff-text-2)' }}>vs</span>
            <span style={{ color: COLORS.b }}>{cpuB.name}</span>
          </h1>
          <p className="text-base max-w-2xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Estimated gaming FPS in {games.length} games at 1080p, 1440p, and 4K — plus specs and price-per-frame value.
            Paired with an {gpu.name} so the CPU is the bottleneck wherever a game allows it.
          </p>
        </motion.div>

        {/* Verdict cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <Trophy size={18} className="mx-auto mb-2" style={{ color: 'var(--ff-accent)' }} />
            <p className="text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>{isTie ? '🤝 Overall Result' : '🏆 FPS King'} ({resLabels[resolution]} High)</p>
            {isTie ? (
              <>
                <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>Dead Heat</p>
                <p className="text-xs mt-1" style={{ color: 'var(--ff-text-3)' }}>{fmtAvg(avgAF)} vs {fmtAvg(avgBF)} avg FPS — buy the better value</p>
              </>
            ) : (
              <>
                <p className="text-lg font-black" style={{ color: winner === cpuA ? COLORS.a : COLORS.b }}>{winner.name}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--ff-text-3)' }}>{fmtAvg(avgAF)} vs {fmtAvg(avgBF)} avg FPS</p>
              </>
            )}
          </div>
          <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <Zap size={18} className="mx-auto mb-2" style={{ color: 'var(--ff-cyan)' }} />
            <p className="text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>⚡ Games Won</p>
            <p className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>
              <span style={{ color: COLORS.a }}>{winsA}</span>
              <span className="mx-2" style={{ color: 'var(--ff-text-3)' }}>—</span>
              <span style={{ color: COLORS.b }}>{winsB}</span>
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--ff-text-3)' }}>of {rows.length} games{tooClose > 0 ? ` · ${tooClose} too close to call` : ''}</p>
          </div>
          <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <DollarSign size={18} className="mx-auto mb-2" style={{ color: '#00E676' }} />
            <p className="text-xs mb-1" style={{ color: 'var(--ff-text-2)' }}>💰 Better Value</p>
            <p className="text-lg font-black" style={{ color: valueWinner === cpuA ? COLORS.a : COLORS.b }}>{valueWinner.name}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--ff-text-3)' }}>
              {valueA} vs {valueB} FPS per $100
            </p>
          </div>
        </div>

        {/* Written verdict */}
        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-2 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
            <Trophy size={16} style={{ color: 'var(--ff-accent)' }} /> Verdict
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{verdictText}</p>
        </div>

        {/* FPS table */}
        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
              <Zap size={16} style={{ color: 'var(--ff-accent)' }} />
              FPS Estimates — High Settings
            </h2>
            <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--ff-border)' }}>
              {resolutions.map(r => (
                <button key={r} onClick={() => setResolution(r)}
                  className="px-4 py-2 text-xs font-semibold transition-colors"
                  style={resolution === r
                    ? { backgroundColor: 'var(--ff-accent)', color: '#fff' }
                    : { backgroundColor: 'transparent', color: 'var(--ff-text-2)' }}>
                  {resLabels[r]}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ff-border)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--ff-text-2)' }}>Game</th>
                  <th className="text-right py-2 px-4 font-semibold" style={{ color: COLORS.a }}>{cpuA.name}</th>
                  <th className="text-right py-2 px-4 font-semibold" style={{ color: COLORS.b }}>{cpuB.name}</th>
                  <th className="text-right py-2 pl-4 font-medium" style={{ color: 'var(--ff-text-2)' }}>Diff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const diff = r.fpsA - r.fpsB;
                  const aWins = r.fpsA > r.fpsB * WIN_MARGIN;
                  const bWins = r.fpsB > r.fpsA * WIN_MARGIN;
                  return (
                    <tr key={r.game} style={{ borderBottom: '1px solid var(--ff-border)' }}>
                      <td className="py-2 pr-4" style={{ color: 'var(--ff-text)' }}>{r.game}</td>
                      <td className="text-right py-2 px-4 font-bold"
                        style={{ color: aWins ? COLORS.a : 'var(--ff-text-2)' }}>{r.fpsA}</td>
                      <td className="text-right py-2 px-4 font-bold"
                        style={{ color: bWins ? COLORS.b : 'var(--ff-text-2)' }}>{r.fpsB}</td>
                      <td className="text-right py-2 pl-4 text-xs"
                        style={{ color: aWins ? COLORS.a : bWins ? COLORS.b : 'var(--ff-text-3)' }}>
                        {diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '='}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
            Estimates assume native resolution with no upscaling (DLSS/FSR/XeSS) and an {gpu.name}. Modern gaming CPUs
            are close: in GPU-limited games the difference shrinks to nothing, and real gaps show up mostly in
            CPU-heavy esports titles. Real-world results vary by RAM speed, game patch, and system configuration.
            Prices are typical US street pricing, last updated {PRICES_UPDATED}.
          </p>
        </div>

        {/* Specs */}
        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Spec Comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ff-border)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--ff-text-2)' }}></th>
                  <th className="text-right py-2 px-4 font-semibold" style={{ color: COLORS.a }}>{cpuA.name}</th>
                  <th className="text-right py-2 pl-4 font-semibold" style={{ color: COLORS.b }}>{cpuB.name}</th>
                </tr>
              </thead>
              <tbody>
                {specs.map(s => (
                  <tr key={s.label} style={{ borderBottom: '1px solid var(--ff-border)' }}>
                    <td className="py-2 pr-4" style={{ color: 'var(--ff-text-2)' }}>{s.label}</td>
                    <td className="text-right py-2 px-4" style={{ color: 'var(--ff-text)' }}>{s.a}</td>
                    <td className="text-right py-2 pl-4" style={{ color: 'var(--ff-text)' }}>{s.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            {[cpuA, cpuB].map((c, i) => (
              <div key={c.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--ff-text-2)' }}>
                <span className="font-semibold" style={{ color: i === 0 ? COLORS.a : COLORS.b }}>{c.name}:</span>
                <a href={getAffiliateUrl(buildPartQuery(c.name, c.brand, 'cpu'))} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent)' }}>
                  Amazon <ExternalLink size={10} />
                </a>
                <a href={getNeweggUrl(buildPartQuery(c.name, c.brand, 'cpu'))} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
                  Newegg <ExternalLink size={10} />
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to={`/compare?cpuA=${cpuA.id}&cpuB=${cpuB.id}`}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Customize This Comparison
          </Link>
          <Link to={`/builder?cpu=${recommended.id}`}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}>
            Build with the {recommended.name}{isTie ? ' (better value)' : ''} <ChevronRight size={14} />
          </Link>
        </div>

        {/* Related matchups */}
        {related.length > 0 && (
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Related Comparisons</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {related.map(m => (
                <Link key={m.slug} to={`/vs/${m.slug}`}
                  className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                  <span>{getCpuMatchupTitle(m)}</span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
