import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-[#0A0A0F] border-t border-white/5 mt-20">
      <div id="ad-footer" className="ad-slot mx-4 my-4" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <Link to="/" className="flex items-center gap-2 mb-3">
              <svg viewBox="0 0 40 46" fill="none" className="w-8 h-8">
                <path d="M20 2L37 11.5V28.5L20 38L3 28.5V11.5L20 2Z" fill="url(#fhex)" opacity="0.15"/>
                <path d="M20 2L37 11.5V28.5L20 38L3 28.5V11.5L20 2Z" stroke="url(#fhex)" strokeWidth="1.5"/>
                <text x="20" y="26" textAnchor="middle" fill="url(#fhex)" fontSize="14" fontWeight="800" fontFamily="Inter">FF</text>
                <defs>
                  <linearGradient id="fhex" x1="3" y1="2" x2="37" y2="38" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6C63FF"/>
                    <stop offset="1" stopColor="#00D4FF"/>
                  </linearGradient>
                </defs>
              </svg>
              <span className="font-bold text-lg text-white">Frame<span className="gradient-text">Forge</span></span>
            </Link>
            <p className="text-[#8888AA] text-sm">Build it. Benchmark it. Own it.</p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-3">Navigation</h4>
            <div className="flex flex-col gap-2">
              {[
                { to: '/', label: 'Home' },
                { to: '/builder', label: 'Builder' },
                { to: '/prebuilts', label: 'Prebuilts' },
                { to: '/compare', label: 'Compare' },
                { to: '/about', label: 'About' },
              ].map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-[#8888AA] hover:text-white text-sm transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-3">Disclosure</h4>
            <p className="text-[#8888AA] text-xs leading-relaxed mb-3">
              As an Amazon Associate, FrameForge earns from qualifying purchases.
            </p>
            <p className="text-[#8888AA] text-xs leading-relaxed">
              FPS estimates are based on benchmark data and should be used as a guide only. Actual performance varies by driver version, game patch, and system configuration.
            </p>
          </div>
        </div>

        <div className="border-t border-white/5 mt-8 pt-8 text-center">
          <p className="text-[#8888AA] text-xs">© 2025 FrameForge. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
