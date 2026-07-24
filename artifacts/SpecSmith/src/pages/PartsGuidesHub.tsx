import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronRight, CircuitBoard, MemoryStick, HardDrive, Zap, Box, Fan,
  Monitor, Keyboard, Mouse, Headphones, TrendingUp, Trophy,
} from 'lucide-react';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const GUIDE_LINKS = [
  { to: '/gpu-tier-list', label: 'GPU Tier List', desc: 'Every GPU ranked S to D', icon: Trophy },
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

export default function PartsGuidesHub() {
  useSeo(getRouteMeta('/parts-guides'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
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
