import { Link } from 'react-router-dom';
import Logo from './Logo';

const NAV_GROUPS = [
  {
    heading: 'Build',
    links: [
      { to: '/', label: 'Home' },
      { to: '/builder', label: 'Builder' },
      { to: '/prebuilts', label: 'Build Guides' },
    ],
  },
  {
    heading: 'Compare & Research',
    links: [
      { to: '/compare', label: 'Compare Builds' },
      { to: '/vs', label: 'GPU & CPU Comparisons' },
      { to: '/best-gpu', label: 'Best GPU by Game' },
      { to: '/best-cpu', label: 'Best CPU by Game' },
      { to: '/gpu-tier-list', label: 'GPU Tier List' },
      { to: '/cpu-tier-list', label: 'CPU Tier List' },
      { to: '/upgrade', label: 'GPU Upgrade Guides' },
      { to: '/upgrade-cpu', label: 'CPU Upgrade Guides' },
    ],
  },
  {
    heading: 'Parts Guides',
    headingTo: '/parts-guides',
    links: [
      { to: '/best-motherboard', label: 'Best Motherboards' },
      { to: '/best-ram', label: 'Best RAM' },
      { to: '/best-storage', label: 'Best Storage' },
      { to: '/best-psu', label: 'Best Power Supplies' },
      { to: '/best-case', label: 'Best Cases' },
      { to: '/best-cooler', label: 'Best CPU Coolers' },
      { to: '/best-monitor', label: 'Best Monitors' },
      { to: '/best-keyboard', label: 'Best Keyboards' },
      { to: '/best-mouse', label: 'Best Mice' },
      { to: '/best-headset', label: 'Best Headsets' },
    ],
  },
];

export default function Footer() {
  return (
    <footer style={{ backgroundColor: 'var(--ff-bg)', borderTop: '1px solid var(--ff-border)', marginTop: '5rem' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8">
          {/* Brand */}
          <div>
            <Link to="/" className="flex items-center gap-2 mb-3">
              <Logo size={32} className="w-8 h-8" />
              <span className="font-bold text-lg" style={{ color: 'var(--ff-text)' }}>
                Spec<span className="gradient-text">Smith</span>
              </span>
            </Link>
            <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Build it. Benchmark it. Own it.</p>
          </div>

          {/* Grouped nav */}
          {NAV_GROUPS.map(group => (
            <div key={group.heading}>
              {group.headingTo ? (
                <Link to={group.headingTo} className="block font-semibold text-sm mb-3 transition-colors hover:opacity-80" style={{ color: 'var(--ff-text)' }}>
                  {group.heading}
                </Link>
              ) : (
                <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>{group.heading}</h2>
              )}
              <div className="flex flex-col gap-2">
                {group.links.map(link => (
                  <Link key={link.to} to={link.to}
                    className="text-sm transition-colors hover:opacity-80"
                    style={{ color: 'var(--ff-text-2)' }}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {/* Legal */}
          <div>
            <h2 className="font-semibold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Disclosure</h2>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--ff-text-2)' }}>
              As an Amazon Associate, SpecSmith earns from qualifying purchases.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              FPS estimates are based on benchmark data and should be used as a guide only. Actual performance varies by driver version, game patch, and system configuration.
            </p>
            <Link to="/about" className="inline-block text-sm mt-3 transition-colors hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              About SpecSmith
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-8 text-center" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <p className="text-xs" style={{ color: 'var(--ff-text-3)' }}>© {new Date().getFullYear()} SpecSmith. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
