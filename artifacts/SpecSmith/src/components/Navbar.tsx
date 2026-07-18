import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Cpu, Moon, Sun, LayoutDashboard, Settings, LogOut, ChevronDown } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/builder', label: 'Builder' },
  { to: '/prebuilts', label: 'Build Guides' },
  { to: '/compare', label: 'Compare' },
  { to: '/about', label: 'About' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, builds, logout } = useAuth();
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMenuOpen(false); setAvatarOpen(false); }, [location.pathname]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => { logout(); navigate('/'); };

  const isDark = theme === 'dark';

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'shadow-lg' : ''
        }`}
        style={{
          backgroundColor: scrolled
            ? 'var(--ff-nav-bg)'
            : 'transparent',
          backdropFilter: scrolled ? 'blur(12px)' : undefined,
          borderBottom: scrolled ? '1px solid var(--ff-border)' : undefined,
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group flex-shrink-0">
              <Logo size={32} className="w-8 h-8" />
              <span className="font-bold text-xl tracking-tight" style={{ color: 'var(--ff-text)' }}>
                Spec<span className="gradient-text">Smith</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                  style={{
                    color: location.pathname === link.to ? 'var(--ff-text)' : 'var(--ff-text-2)',
                    backgroundColor: location.pathname === link.to ? 'var(--ff-card)' : 'transparent',
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg transition-all duration-200"
                style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}
                aria-label="Toggle theme"
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={theme}
                    initial={{ opacity: 0, rotate: -30 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: 30 }}
                    transition={{ duration: 0.15 }}
                    className="flex"
                  >
                    {isDark ? <Moon size={17} /> : <Sun size={17} />}
                  </motion.span>
                </AnimatePresence>
              </button>

              {/* Auth */}
              {user ? (
                <div ref={avatarRef} className="relative">
                  <button
                    onClick={() => setAvatarOpen(!avatarOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
                    style={{ color: 'var(--ff-text)', backgroundColor: 'var(--ff-card)' }}
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                      {user.username[0].toUpperCase()}
                    </div>
                    <span className="hidden sm:block text-sm font-medium">{user.username}</span>
                    <ChevronDown size={14} className={`transition-transform ${avatarOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--ff-text-2)' }} />
                  </button>

                  <AnimatePresence>
                    {avatarOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-52 rounded-xl overflow-hidden shadow-2xl z-50"
                        style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)', transformOrigin: 'top right' }}
                      >
                        {[
                          { icon: <LayoutDashboard size={14} />, label: 'My Dashboard', to: '/dashboard' },
                          { icon: <Cpu size={14} />, label: `My Builds (${builds.length})`, to: '/dashboard' },
                          { icon: <Settings size={14} />, label: 'Settings', to: '/settings' },
                        ].map(item => (
                          <Link key={item.to + item.label} to={item.to}
                            className="flex items-center gap-3 px-4 py-3 text-sm transition-colors"
                            style={{ color: 'var(--ff-text)' }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--ff-card)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}>
                            <span style={{ color: 'var(--ff-text-2)' }}>{item.icon}</span>
                            {item.label}
                          </Link>
                        ))}
                        <div style={{ borderTop: '1px solid var(--ff-border)' }} />
                        <button onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left"
                          style={{ color: '#FF1744' }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FF174410')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}>
                          <LogOut size={14} /> Sign Out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="hidden sm:flex px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ color: 'var(--ff-text-2)' }}
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/builder"
                    className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-105"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                  >
                    <Cpu size={15} />
                    Start Building
                  </Link>
                </>
              )}

              {/* Mobile hamburger */}
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden p-2 rounded-lg transition-colors"
                style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}
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
            className="fixed top-16 left-0 right-0 z-40 md:hidden"
            style={{ backgroundColor: 'var(--ff-nav-bg)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--ff-border)' }}
          >
            <div className="px-4 py-4 space-y-1">
              {navLinks.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="block px-4 py-3 rounded-lg text-base font-medium transition-colors"
                  style={{
                    color: location.pathname === link.to ? 'var(--ff-text)' : 'var(--ff-text-2)',
                    backgroundColor: location.pathname === link.to ? 'var(--ff-card)' : 'transparent',
                  }}
                >
                  {link.label}
                </Link>
              ))}
              {user ? (
                <>
                  <Link to="/dashboard" className="block px-4 py-3 rounded-lg text-base font-medium"
                    style={{ color: 'var(--ff-text)' }}>My Dashboard</Link>
                  <Link to="/settings" className="block px-4 py-3 rounded-lg text-base font-medium"
                    style={{ color: 'var(--ff-text)' }}>Settings</Link>
                  <button onClick={handleLogout} className="block w-full text-left px-4 py-3 rounded-lg text-base font-medium"
                    style={{ color: '#FF1744' }}>Sign Out</button>
                </>
              ) : (
                <>
                  <Link to="/login" className="block px-4 py-3 rounded-lg text-base font-medium"
                    style={{ color: 'var(--ff-text-2)' }}>Sign In</Link>
                  <Link to="/builder"
                    className="flex items-center justify-center gap-2 mt-2 px-4 py-3 rounded-lg text-base font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    <Cpu size={16} /> Start Building
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
