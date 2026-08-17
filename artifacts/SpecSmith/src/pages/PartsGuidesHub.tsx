import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronRight, CircuitBoard, MemoryStick, HardDrive, Zap, Box, Fan,
  Monitor, Keyboard, Mouse, Headphones, TrendingUp, Trophy, DollarSign, Sparkles,
} from 'lucide-react';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const GUIDE_LINKS = [
  { to: '/gpu-tier-list', label: 'GPU Tier List', desc: 'Every GPU ranked S to D', icon: Trophy },
  { to: '/cpu-tier-list', label: 'CPU Tier List', desc: 'Every CPU ranked S to D', icon: Trophy },
  { to: '/best-gpu-budget', label: 'Best GPU by Budget', desc: 'Strongest card under your price ceiling', icon: DollarSign },
  { to: '/best-cpu-budget', label: 'Best CPU by Budget', desc: 'Strongest chip under your price ceiling', icon: DollarSign },
  { to: '/best-pc-for', label: 'Best PC by Use Case', desc: 'Streaming, video editing, and more', icon: Sparkles },
  { to: '/upgrade', label: 'GPU Upgrade Guides', desc: 'What to upgrade your card to', icon: TrendingUp },
  { to: '/upgrade-cpu', label: 'CPU Upgrade Guides', desc: 'What to upgrade your chip to', icon: TrendingUp },
  { to: '/best-motherboard', label: 'Motherboards', desc: 'By platform: AM4, AM5, LGA1700, LGA1851', icon: CircuitBoard },
  { to: '/best-ram', label: 'RAM', desc: 'DDR4 and DDR5 kits compared', icon: MemoryStick },
  { to: '/best-storage', label: 'Storage', desc: 'NVMe, SATA SSD, and HDD options', icon: HardDrive },
  { to: '/best-psu', label: 'Power Supplies', desc: 'Budget to high-wattage picks', icon: Zap },
  { to: '/best-case', label: 'Cases', desc: 'Mini, mid, and full tower options', icon: Box },
  { to: '/best-cooler', label: 'CPU Coolers', desc: 'Air coolers and AIO liquid coolers', icon: Fan },
  { to: '/best-monitor', label: 'Monitors', desc: '1080p to 4K, up to 360Hz', icon: Monitor },
  { to: '/best-keyboard', label: 'Keyboards', desc: 'Mechanical switches, wired and wireless', icon: Keyboard },
  { to: '/best-mouse', label: 'Mice', desc: 'Budget, lightweight, and high-end picks', icon: Mouse },
  { to: '/best-headset', label: 'Headsets', desc: 'Wired and wireless, with mic quality', icon: Headphones },
];

const faqs = [
  {
    title: "What's the difference between the Tier Lists and the Budget guides?",
    content: 'Tier Lists rank every GPU or CPU we track purely on performance, S to D, regardless of price. Budget guides filter down to whatever fits under a specific price ceiling, ranked by benchmark score within that limit — use Tier Lists to see the full performance picture, Budget guides when you have a firm spending cap.',
  },
  {
    title: 'These guides, the PC Build Quiz, Best PC by Use Case, and Build Crate all recommend parts — which one should I actually use?',
    content: 'They\'re not the same tool wearing different skins — each picks by different criteria for a different situation. The Tier Lists and Budget/RAM/Storage/etc. guides on this page rank every part we track by raw benchmark performance or price, for browsing on your own terms. The 2-question PC Build Quiz and Best PC by Use Case guides pick a specific GPU+CPU pair matched to what you\'ll actually use the PC for (gaming, streaming, video editing) and your budget — faster if you just want an answer. Build Crate is the odd one out: it\'s a for-fun randomizer, not a recommendation — every pull is still guaranteed to be fully compatible, but what you land on is chance, not a pick for your situation. If you want a specific answer fast, use the Quiz or a Use Case guide. If you want to compare every option yourself, use the guides on this page. If you just want to see a random compatible build, open a Crate.',
  },
  {
    title: 'Are these guides kept up to date?',
    content: 'Prices refresh monthly as part of the site\'s regular data update, and tier/budget rankings recalculate automatically from the current dataset — nothing here is a static, one-time snapshot.',
  },
  {
    title: "Where do I start if I'm building my first PC?",
    content: 'Skip straight to the Builder — pick parts as you go and it flags socket mismatches, PSU wattage shortfalls, and case clearance issues in real time, so you don\'t need to read every guide here first to avoid a bad combination.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.title,
    acceptedAnswer: { '@type': 'Answer', text: f.content },
  })),
};

export default function PartsGuidesHub() {
  useSeo(getRouteMeta('/parts-guides'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Parts <span className="gradient-text">Guides</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Every buying guide on SpecSmith in one place — GPU and CPU tiers, upgrade advice, and picks for every other part in your build.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GUIDE_LINKS.map((g, i) => {
            const Icon = g.icon;
            return (
              <motion.div key={g.to}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 8) * 0.04 }}>
                <Link to={g.to}
                  className="flex items-center justify-between rounded-xl p-4 transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                  <div className="flex items-center gap-3">
                    <Icon size={18} style={{ color: 'var(--ff-accent)' }} />
                    <div>
                      <span className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>{g.label}</span>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--ff-text-3)' }}>{g.desc}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--ff-text-3)' }} />
                </Link>
              </motion.div>
            );
          })}
        </div>

        <div className="space-y-3 mt-12 mb-2">
          {faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link to="/builder"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Start a Build <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
