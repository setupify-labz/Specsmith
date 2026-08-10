import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Cpu, ExternalLink } from 'lucide-react';
import { getSffPicks, getSffPageMeta, sffItemListJsonLd, sffFaqs, sffFaqJsonLd } from '../lib/sffBuilds';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

function PartRow({ label, name, price, category, brand }: { label: string; name: string; price: number; category: string; brand: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5" style={{ borderBottom: '1px solid var(--ff-border)' }}>
      <span className="text-[10px] uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--ff-text-3)' }}>{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--ff-text)' }}>{name}</span>
        <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--ff-text)' }}>${price.toLocaleString()}</span>
        <a href={getAffiliateUrl(buildPartQuery(name, brand, category))} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-0.5 text-[10px] font-semibold hover:opacity-80 flex-shrink-0"
          style={{ color: 'var(--ff-accent-text)' }}>
          Buy <ExternalLink size={9} />
        </a>
      </div>
    </div>
  );
}

export default function SffBuildPage() {
  useSeo(getSffPageMeta());
  const picks = getSffPicks();

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(sffItemListJsonLd(picks)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(sffFaqJsonLd()) }} />
      <PageGlow />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <Link to="/best-pc-for" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← All Use-Case Guides
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Best Small Form Factor <span className="gradient-text">(Mini-ITX)</span> Build
          </h1>
          <p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            Small cases fail builds in ways price-and-performance picks don't catch — a GPU that's a centimeter too long, a tower cooler that won't let the side panel close. Every part below, including the case and cooler, is checked against real clearance specs, not just budget.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {picks.map(p => (
            <div key={p.tier.slug} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--ff-accent-text)' }}>{p.tier.label}</p>
              <p className="text-[11px] mb-3 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
                {p.case.name} — {p.case.gpu_clearance_mm}mm GPU clearance, {p.case.cooler_clearance_mm}mm cooler clearance
              </p>
              <div className="space-y-0.5">
                <PartRow label="Case" name={p.case.name} price={p.case.price_usd} category="case" brand="" />
                <PartRow label="Motherboard" name={p.motherboard.name} price={p.motherboard.price_usd} category="motherboard" brand={p.motherboard.name.split(' ')[0]} />
                <PartRow label="CPU" name={p.cpu.name} price={p.cpu.price_usd} category="cpu" brand={p.cpu.brand} />
                <PartRow label="Cooler" name={p.cooler.name} price={p.cooler.price_usd} category="cooler" brand="Noctua" />
                <PartRow label="GPU" name={p.gpu.name} price={p.gpu.price_usd} category="gpu" brand={p.gpu.brand} />
              </div>
              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--ff-border)' }}>
                <span className="text-xs font-semibold" style={{ color: 'var(--ff-text-2)' }}>Total</span>
                <span className="text-lg font-black" style={{ color: 'var(--ff-text)' }}>
                  ${(p.case.price_usd + p.motherboard.price_usd + p.cpu.price_usd + p.cooler.price_usd + p.gpu.price_usd).toLocaleString()}
                </span>
              </div>
              <Link to={`/builder?gpu=${p.gpu.id}&cpu=${p.cpu.id}&motherboard=${p.motherboard.id}&cooler=${p.cooler.id}&case=${p.case.id}`}
                className="mt-4 flex items-center justify-center gap-1 text-xs font-semibold py-2 rounded-lg hover:opacity-80"
                style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)' }}>
                Load in Builder
              </Link>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-6 mb-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <h2 className="font-bold mb-2 text-sm" style={{ color: 'var(--ff-text)' }}>How we picked these</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            Both builds use the same CPU, motherboard, and cooler platform — the strongest CPU whose power draw fits under a low-profile cooler rated for these cases' tight clearances, on the one Mini-ITX motherboard we track. Only the GPU changes between tiers: the highest-benchmark card that physically fits each case's clearance (with a 15mm safety margin, since exact card length varies by manufacturer) under a price ceiling matched to that tier.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link to="/builder"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            <Cpu size={15} /> Start a Custom Build
          </Link>
        </div>

        <div className="space-y-3">
          {sffFaqs.map((f) => (
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
