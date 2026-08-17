import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu, ExternalLink } from 'lucide-react';
import { getUseCase, getTierPicks, getTierComparisons, getUseCasePageMeta, useCaseItemListJsonLd, useCaseFaqJsonLd, USE_CASES } from '../lib/useCaseBuilds';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

export default function UseCaseBuildPage() {
  const { slug } = useParams<{ slug: string }>();
  const useCase = slug ? getUseCase(slug) : undefined;

  const fallbackMeta = {
    path: '/best-pc-for',
    title: 'Build Guide Not Found | SpecSmith',
    description: 'This use-case build guide could not be found. Browse all use-case guides instead.',
    noindex: true,
  };
  useSeo(useCase ? getUseCasePageMeta(useCase) : fallbackMeta);

  if (!useCase) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Build guide not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have a guide for this use case yet.</p>
          <Link to="/best-pc-for" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Browse All Use Cases
          </Link>
        </div>
      </div>
    );
  }

  const picks = getTierPicks(useCase);
  const comparisons = getTierComparisons(picks);
  const related = USE_CASES.filter(u => u.slug !== useCase.slug);

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(useCaseItemListJsonLd(useCase, picks)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(useCaseFaqJsonLd(useCase)) }} />
      <PageGlow />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <Link to="/best-pc-for" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All Use-Case Guides
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            {useCase.title}
          </h1>
          <p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {useCase.intro}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {comparisons.map(p => (
            <div key={p.tier.label} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ff-accent-text)' }}>{p.tier.label}</p>
                <p className="text-sm font-black" style={{ color: 'var(--ff-text)' }}>${p.totalCost.toLocaleString()} <span className="text-[10px] font-normal" style={{ color: 'var(--ff-text-3)' }}>total</span></p>
              </div>

              <div className="mb-3 pb-3" style={{ borderBottom: '1px solid var(--ff-border)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>GPU</p>
                <p className="font-bold" style={{ color: 'var(--ff-text)' }}>{p.gpu.name}</p>
                <div className="flex items-center gap-2 text-xs mt-1">
                  <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${p.gpu.price_usd}</span>
                  <a href={getAffiliateUrl(buildPartQuery(p.gpu.name, p.gpu.brand, 'gpu'))} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                    Amazon <ExternalLink size={9} />
                  </a>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>CPU</p>
                <p className="font-bold" style={{ color: 'var(--ff-text)' }}>{p.cpu.name}</p>
                <div className="flex items-center gap-2 text-xs mt-1">
                  <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${p.cpu.price_usd}</span>
                  <a href={getAffiliateUrl(buildPartQuery(p.cpu.name, p.cpu.brand, 'cpu'))} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                    Amazon <ExternalLink size={9} />
                  </a>
                </div>
              </div>

              <Link to={`/builder?gpu=${p.gpu.id}&cpu=${p.cpu.id}`}
                className="mt-4 flex items-center justify-center gap-1 text-xs font-semibold py-2 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)' }}>
                Load in Builder <ChevronRight size={12} />
              </Link>

              {/* Is stepping up to this tier actually worth it? Real cost + spec
                  deltas versus the tier to the left, computed from the picks above —
                  not shown on the cheapest tier, which has nothing to step up from. */}
              {p.stepUp && (
                <p className="text-[11px] leading-relaxed mt-3 pt-3" style={{ color: 'var(--ff-text-3)', borderTop: '1px solid var(--ff-border)' }}>
                  <span style={{ color: 'var(--ff-text-2)', fontWeight: 600 }}>+${p.stepUp.costDelta.toLocaleString()}</span> over the previous tier gets you {p.stepUp.gpuClause} and {p.stepUp.cpuClause}.
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-2 text-sm" style={{ color: 'var(--ff-text)' }}>How we picked these</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{useCase.criteria}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to="/builder"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Start a Custom Build
          </Link>
        </div>

        {related.length > 0 && (
          <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Other Use-Case Guides</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {related.map(r => (
                <Link key={r.slug} to={`/best-pc-for/${r.slug}`}
                  className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                  <span>Best PC for {r.shortTitle}</span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {useCase.faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
