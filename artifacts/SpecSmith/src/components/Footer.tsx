import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer style={{ backgroundColor: 'var(--ff-bg)', borderTop: '1px solid var(--ff-border)', marginTop: '5rem' }}>
      <div id="ad-footer" className="ad-slot mx-4 my-4" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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

          {/* Links */}
          <div>
            <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Navigation</h4>
            <div className="flex flex-col gap-2">
              {[
                { to: '/', label: 'Home' },
                { to: '/builder', label: 'Builder' },
                { to: '/prebuilts', label: 'Build Guides' },
                { to: '/compare', label: 'Compare' },
                { to: '/vs', label: 'GPU & CPU Comparisons' },
                { to: '/best-gpu', label: 'Best GPU by Game' },
                { to: '/best-cpu', label: 'Best CPU by Game' },
                { to: '/gpu-tier-list', label: 'GPU Tier List' },
                { to: '/about', label: 'About' },
              ].map(link => (
                <Link key={link.to} to={link.to}
                  className="text-sm transition-colors hover:opacity-80"
                  style={{ color: 'var(--ff-text-2)' }}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--ff-text)' }}>Disclosure</h4>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--ff-text-2)' }}>
              As an Amazon Associate, SpecSmith earns from qualifying purchases.
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              FPS estimates are based on benchmark data and should be used as a guide only. Actual performance varies by driver version, game patch, and system configuration.
            </p>
          </div>
        </div>

        <div className="mt-8 pt-8 text-center" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <p className="text-xs" style={{ color: 'var(--ff-text-3)' }}>© {new Date().getFullYear()} SpecSmith. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
