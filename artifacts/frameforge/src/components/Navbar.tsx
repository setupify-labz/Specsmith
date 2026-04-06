import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Cpu } from 'lucide-react';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/builder', label: 'Builder' },
  { to: '/prebuilts', label: 'Prebuilts' },
  { to: '/compare', label: 'Compare' },
  { to: '/about', label: 'About' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-[#0A0A0F]/90 backdrop-blur-xl shadow-lg shadow-black/30 border-b border-white/5' : 'bg-transparent'
        }`}
      >
        <div id="ad-header" className="ad-slot hidden" style={{ minHeight: 0 }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 relative flex items-center justify-center">
                <svg viewBox="0 0 40 46" fill="none" className="w-9 h-9">
                  <path d="M20 2L37 11.5V28.5L20 38L3 28.5V11.5L20 2Z" fill="url(#hexGrad)" opacity="0.15"/>
                  <path d="M20 2L37 11.5V28.5L20 38L3 28.5V11.5L20 2Z" stroke="url(#hexGrad)" strokeWidth="1.5"/>
                  <text x="20" y="26" textAnchor="middle" fill="url(#hexGrad)" fontSize="14" fontWeight="800" fontFamily="Inter">FF</text>
                  <defs>
                    <linearGradient id="hexGrad" x1="3" y1="2" x2="37" y2="38" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#6C63FF"/>
                      <stop offset="1" stopColor="#00D4FF"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span className="font-bold text-xl tracking-tight text-white group-hover:text-white/90 transition-colors">
                Frame<span className="gradient-text">Forge</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    location.pathname === link.to
                      ? 'text-white bg-white/10'
                      : 'text-[#8888AA] hover:text-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* CTA + Mobile toggle */}
            <div className="flex items-center gap-3">
              <Link
                to="/builder"
                className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' }}
              >
                <Cpu size={15} />
                Start Building
              </Link>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden p-2 rounded-lg text-[#8888AA] hover:text-white hover:bg-white/5 transition-colors"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed top-16 left-0 right-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-xl border-b border-white/5 md:hidden"
          >
            <div className="px-4 py-4 space-y-1">
              {navLinks.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === link.to
                      ? 'text-white bg-white/10'
                      : 'text-[#8888AA] hover:text-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                to="/builder"
                className="flex items-center justify-center gap-2 mt-3 px-4 py-3 rounded-lg text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' }}
              >
                <Cpu size={15} />
                Start Building
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
