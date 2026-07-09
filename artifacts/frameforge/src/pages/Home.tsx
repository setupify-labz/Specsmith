import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Cpu, Zap, DollarSign, ChevronRight, Monitor } from 'lucide-react';
import prebuilts from '../data/prebuilts.json';

const stats = [
  { value: '50+', label: 'GPUs Tracked' },
  { value: '50+', label: 'CPUs Tracked' },
  { value: '20', label: 'Games Benchmarked' },
  { value: 'Free', label: 'Forever' },
];

const features = [
  {
    icon: <Cpu size={24} className="text-[#6C63FF]" />,
    title: 'Part Picker',
    description: 'Choose from 100+ real components with live compatibility checks to ensure everything works together perfectly.',
  },
  {
    icon: <Zap size={24} className="text-[#00D4FF]" />,
    title: 'FPS Estimator',
    description: 'See estimated FPS in 20 games at 1080p, 1440p, and 4K — across all quality presets before you spend a cent.',
  },
  {
    icon: <DollarSign size={24} className="text-[#00E676]" />,
    title: 'Price Tracker',
    description: 'Know your total build cost instantly. Every component shows real pricing with direct links to purchase.',
  },
];

const prebuiltHighlights = prebuilts.map(p => ({
  id: p.id,
  name: p.name,
  tagline: p.tagline,
  price: p.estimated_price,
}));

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative min-h-screen flex items-center overflow-hidden pt-16">
        <div className="animated-grid" />
        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-[#6C63FF]/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-[#00D4FF]/8 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#6C63FF]/15 border border-[#6C63FF]/30 text-[#6C63FF] text-sm font-medium mb-6">
              <Monitor size={14} />
              PC Builder + FPS Estimator
            </span>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white mb-6 leading-tight">
              Know Your FPS<br />
              <span className="gradient-text">Before You Buy</span>
            </h1>
            <p className="text-xl text-[#8888AA] max-w-2xl mx-auto mb-10 leading-relaxed">
              Build your dream PC and see exactly how it performs in 20 top games — before spending a dollar.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
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
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg border border-white/20 hover:border-[#6C63FF]/50 hover:bg-[#6C63FF]/10 transition-all"
              >
                See Prebuilts
                <ChevronRight size={18} />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats bar */}
      <div id="ad-sidebar" className="ad-slot mx-4 max-w-7xl lg:mx-auto mb-4 hidden lg:flex items-center justify-center">
        <span className="text-[#8888AA] text-xs">Advertisement</span>
      </div>
      <section className="border-y border-white/5 bg-[#13131A]/50 py-8">
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
                <div className="text-[#8888AA] text-sm">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">Everything You Need</h2>
          <p className="text-[#8888AA] text-lg max-w-xl mx-auto">Build smarter with tools designed for real hardware decisions.</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="rounded-2xl border border-white/8 bg-[#1C1C26] p-6 card-hover"
            >
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                {f.icon}
              </div>
              <h3 className="text-white font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-[#8888AA] text-sm leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Prebuilts preview */}
      <section className="py-16 bg-[#0A0A0F]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Popular Builds</h2>
              <p className="text-[#8888AA] text-sm mt-1">Ready-to-go configurations for every budget</p>
            </div>
            <Link
              to="/prebuilts"
              className="flex items-center gap-1 text-[#6C63FF] hover:text-[#00D4FF] text-sm font-medium transition-colors"
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
                className="flex-shrink-0 w-64 rounded-2xl border border-white/8 bg-[#1C1C26] p-5 card-hover"
              >
                <div className="text-xl font-black text-white mb-1">{p.name}</div>
                <p className="text-[#8888AA] text-xs mb-4">{p.tagline}</p>
                <div className="text-2xl font-black gradient-text mb-4">${p.price.toLocaleString()}</div>
                <Link
                  to={`/prebuilts/${p.id}`}
                  className="w-full flex items-center justify-center gap-1 py-2 px-4 rounded-lg text-sm font-semibold text-[#6C63FF] border border-[#6C63FF]/30 hover:bg-[#6C63FF]/10 transition-colors"
                >
                  View Build <ChevronRight size={14} />
                </Link>
              </motion.div>
            ))}
          </div>
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
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">Ready to Build?</h2>
            <p className="text-[#8888AA] text-lg mb-8 max-w-lg mx-auto">
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
    </div>
  );
}
