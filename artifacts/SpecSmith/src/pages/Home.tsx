import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Cpu, Zap, DollarSign, ChevronRight, Monitor, Package, Users, TrendingUp, BookOpen, Trophy, ArrowUpDown, Sparkles } from 'lucide-react';
import { prebuilts, getPrebuiltTotal } from '../lib/prebuilts';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import { PRICES_UPDATED } from '../lib/prices';
import HeroFpsCard from '../components/HeroFpsCard';
import CircuitAccent from '../components/CircuitAccent';

const homeFaqs = [
  {
    title: 'Is SpecSmith really free?',
    content: 'Yes, completely — the Builder, FPS estimates, compatibility checks, and comparisons are all free with no account required. You only need to sign up if you want to save a build to your Dashboard or publish it to the Gallery.',
  },
  {
    title: 'Where do the prices and FPS numbers come from?',
    content: `Prices are estimated US street pricing, refreshed monthly (last updated ${PRICES_UPDATED}). FPS estimates use a transparent tier-based algorithm explained in full on the About page — they're a planning guide to compare parts before you buy, not a live-scraped price feed or a guarantee of exact real-world performance.`,
  },
  {
    title: 'Do I need to know anything about PC building to use this?',
    content: 'No — that\'s the point of the compatibility checker. Pick parts you\'re interested in, and SpecSmith flags socket mismatches, insufficient PSU wattage, case clearance issues, and more before you spend money on something that doesn\'t fit together.',
  },
  {
    title: 'How many parts and games does SpecSmith track?',
    content: '50+ GPUs, 50+ CPUs, and 20 benchmarked games across resolutions and quality presets — plus motherboards, RAM, storage, PSUs, cases, coolers, and peripherals for a full build.',
  },
];

function homeFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: homeFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}

const stats = [
  { value: '50+', label: 'GPUs Tracked' },
  { value: '50+', label: 'CPUs Tracked' },
  { value: '20', label: 'Games Benchmarked' },
  { value: 'Free', label: 'Forever' },
];

const features = [
  {
    icon: <Cpu size={24} className="text-[#6C63FF]" />,
    glow: 'rgba(108,99,255,0.35)',
    title: 'Part Picker',
    description: 'Choose from 100+ real components with live compatibility checks to ensure everything works together perfectly.',
  },
  {
    icon: <Zap size={24} className="text-[var(--ff-cyan)]" />,
    glow: 'rgba(0,212,255,0.35)',
    title: 'FPS Estimator',
    description: 'See estimated FPS in 20 games at 1080p, 1440p, and 4K — across all quality presets before you spend a cent.',
  },
  {
    icon: <DollarSign size={24} className="text-[var(--ff-green)]" />,
    glow: 'rgba(0,230,118,0.35)',
    title: 'Price Tracker',
    description: 'Know your total build cost instantly. Every component shows real pricing with direct links to purchase.',
  },
];

const exploreLinks = [
  {
    icon: <Sparkles size={22} className="text-[#FF6EC7]" />,
    glow: 'rgba(255,110,199,0.3)',
    title: 'PC Build Quiz',
    description: "Not sure what to pick? Answer 2 questions about your use case and budget for a matched GPU + CPU recommendation.",
    to: '/quiz',
    cta: 'Take the Quiz',
  },
  {
    icon: <Package size={22} className="text-[#FFD700]" />,
    glow: 'rgba(255,215,0,0.3)',
    title: 'Build Crate',
    description: 'Open a randomized build, one part at a time — every crate guaranteed to fit together, rarity pulls for how good it lands.',
    to: '/crate',
    cta: 'Open a Crate',
  },
  {
    icon: <Users size={22} className="text-[var(--ff-green)]" />,
    glow: 'rgba(0,230,118,0.3)',
    title: 'Build Gallery',
    description: 'Browse real builds published by other users, with full part lists, buy links, and a most-viewed leaderboard.',
    to: '/gallery',
    cta: 'Browse Builds',
  },
  {
    icon: <TrendingUp size={22} className="text-[var(--ff-cyan)]" />,
    glow: 'rgba(0,212,255,0.3)',
    title: 'Upgrade Guides',
    description: 'See what your current GPU or CPU is worth used, and whether trading up is actually worth the money.',
    to: '/upgrade',
    cta: 'Check Your Upgrade',
  },
  {
    icon: <Trophy size={22} className="text-[var(--ff-amber)]" />,
    glow: 'rgba(255,179,0,0.3)',
    title: 'Tier Lists',
    description: 'Every GPU and CPU we track, ranked S to D by raw performance — with the best-value pick flagged in each tier.',
    to: '/gpu-tier-list',
    cta: 'See the Rankings',
  },
  {
    icon: <BookOpen size={22} className="text-[#6C63FF]" />,
    glow: 'rgba(108,99,255,0.3)',
    title: 'Parts Guides',
    description: 'Budget-to-premium picks for every part — motherboards, RAM, storage, cases, coolers, and peripherals.',
    to: '/parts-guides',
    cta: 'Browse Guides',
  },
  {
    icon: <ArrowUpDown size={22} className="text-[var(--ff-red)]" />,
    glow: 'rgba(255,23,68,0.3)',
    title: 'Higher or Lower',
    description: 'Guess whether the next GPU or CPU costs more or less than the last, using real prices from our Builder. Beat your streak.',
    to: '/price-guesser',
    cta: 'Play Now',
  },
];

const prebuiltHighlights = prebuilts.map(p => ({
  id: p.id,
  name: p.name,
  tagline: p.tagline,
  price: getPrebuiltTotal(p),
}));

export default function Home() {
  useSeo(getRouteMeta('/'));
  return (
    <div className="min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeFaqJsonLd()) }} />
      {/* Hero */}
      <section className="relative min-h-screen flex items-center overflow-hidden pt-16">
        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-[#6C63FF]/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-[#00D4FF]/8 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="text-center lg:text-left"
            >
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#6C63FF]/15 border border-[#6C63FF]/30 text-[var(--ff-accent-text)] text-sm font-medium mb-6">
                <Monitor size={14} />
                Free PC Builder + FPS Estimator
              </span>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-ff-primary mb-6 leading-tight">
                Build the Fastest Gaming PC<br />
                <span className="gradient-text">for Your Budget</span>
              </h1>
              <p className="text-xl text-secondary-custom max-w-2xl mx-auto lg:mx-0 mb-10 leading-relaxed">
                Pick real parts, know your FPS in 20 top games before you buy, and catch compatibility
                problems instantly — free, no account needed.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Link
                  to="/builder"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg transition-all hover:opacity-90 hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' }}
                >
                  <Zap size={18} />
                  Start Building
                </Link>
                <Link
                  to="/prebuilts"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-ff-primary font-bold text-lg border border-subtle hover:border-[#6C63FF]/50 hover:bg-[#6C63FF]/10 transition-all"
                >
                  See Build Guides
                  <ChevronRight size={18} />
                </Link>
              </div>
            </motion.div>

            <HeroFpsCard />
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-subtle bg-surface py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="text-3xl font-black gradient-text mb-1">{s.value}</div>
                <div className="text-secondary-custom text-sm">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-hidden">
        <CircuitAccent />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative z-10 text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-ff-primary mb-4">Everything You Need</h2>
          <p className="text-secondary-custom text-lg max-w-xl mx-auto">Build smarter with tools designed for real hardware decisions.</p>
        </motion.div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="rounded-2xl border border-subtle bg-card-dark p-6 card-hover"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `radial-gradient(circle at 30% 30%, ${f.glow}, transparent 70%)`, border: '1px solid var(--ff-border)' }}
              >
                {f.icon}
              </div>
              <h3 className="text-ff-primary font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-secondary-custom text-sm leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Prebuilts preview */}
      <section className="py-16 bg-ff-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-ff-primary">Popular Builds</h2>
              <p className="text-secondary-custom text-sm mt-1">Ready-to-go configurations for every budget</p>
            </div>
            <Link
              to="/prebuilts"
              className="flex items-center gap-1 text-[var(--ff-accent-text)] hover:text-[var(--ff-cyan)] text-sm font-medium transition-colors"
            >
              View all <ChevronRight size={16} />
            </Link>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
            {prebuiltHighlights.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex-shrink-0 w-64 rounded-2xl border border-subtle bg-card-dark p-5 card-hover"
              >
                <div className="text-xl font-black text-ff-primary mb-1">{p.name}</div>
                <p className="text-secondary-custom text-xs mb-4">{p.tagline}</p>
                <div className="text-2xl font-black gradient-text mb-4">${p.price.toLocaleString()}</div>
                <Link
                  to={`/prebuilts/${p.id}`}
                  className="w-full flex items-center justify-center gap-1 py-2 px-4 rounded-lg text-sm font-semibold text-[var(--ff-accent-text)] border border-[#6C63FF]/30 hover:bg-[#6C63FF]/10 transition-colors"
                >
                  View Build <ChevronRight size={14} />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Explore more */}
      <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 className="text-2xl sm:text-3xl font-black text-ff-primary">More Than a Part Picker</h2>
          <p className="text-secondary-custom text-sm mt-1">Tools and content beyond the basic builder</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {exploreLinks.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="rounded-2xl border border-subtle bg-card-dark p-6 card-hover"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `radial-gradient(circle at 30% 30%, ${f.glow}, transparent 70%)`, border: '1px solid var(--ff-border)' }}
              >
                {f.icon}
              </div>
              <h3 className="text-ff-primary font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-secondary-custom text-sm leading-relaxed mb-4">{f.description}</p>
              <Link
                to={f.to}
                className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ff-accent-text)] hover:text-[var(--ff-cyan)] transition-colors"
              >
                {f.cta} <ChevronRight size={14} />
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA section */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="rounded-3xl overflow-hidden relative p-12 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(0,212,255,0.08))' }}
        >
          <div className="absolute inset-0 border border-[#6C63FF]/20 rounded-3xl" />
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl font-black text-ff-primary mb-4">Ready to Build?</h2>
            <p className="text-secondary-custom text-lg mb-8 max-w-lg mx-auto">
              Pick your parts, check compatibility, and see exactly what FPS you'll get — all for free.
            </p>
            <Link
              to="/builder"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg transition-all hover:opacity-90 hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' }}
            >
              <Cpu size={18} />
              Open the Builder
            </Link>
          </div>
        </motion.div>
      </section>

      {/* FAQ */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="space-y-3">
          {homeFaqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4 border border-subtle bg-card-dark">
              <h2 className="font-bold text-sm mb-1.5 text-ff-primary">{f.title}</h2>
              <p className="text-xs leading-relaxed text-secondary-custom">{f.content}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
