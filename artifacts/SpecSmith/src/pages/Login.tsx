import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import PageGlow from '../components/PageGlow';

export default function Login() {
  const { login, requestPasswordReset } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.ok) {
      navigate('/dashboard');
    } else {
      setError(result.error ?? 'Invalid email or password');
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div className="relative min-h-screen pt-20 flex items-center justify-center px-4" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>
            Welcome <span className="gradient-text">Back</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Log in to access your saved builds</p>
        </div>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className={`rounded-2xl p-8 space-y-4 ${shake ? 'shake' : ''}`}
          style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
        >
          {error && (
            <div className="px-4 py-3 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#FF174418', color: 'var(--ff-red)', border: '1px solid #FF174440' }}>
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ff-text-2)' }}>Email</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }} />
              <input
                type="email"
                className={`ff-input pl-9 ${error ? 'error' : ''}`}
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                placeholder="name@example.com"
                required
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Password</label>
              <button
                type="button"
                onClick={async () => {
                  if (!email.trim()) {
                    showToast('Enter your email above first, then click "Forgot password?"', 'info');
                    return;
                  }
                  const result = await requestPasswordReset(email.trim());
                  showToast(
                    result.ok ? `Password reset email sent to ${email.trim()}` : (result.error ?? 'Could not send reset email'),
                    result.ok ? 'success' : 'error'
                  );
                }}
                className="text-xs hover:opacity-80"
                style={{ color: 'var(--ff-accent-text)' }}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }} />
              <input
                type={showPass ? 'text' : 'password'}
                className={`ff-input pl-9 pr-10 ${error ? 'error' : ''}`}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }}>
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Remember me */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
              className="w-4 h-4 rounded accent-[#6C63FF]" />
            <span className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Remember me</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                     : <LogIn size={15} />}
            {loading ? 'Logging in...' : 'Log In'}
          </button>

          <p className="text-center text-sm" style={{ color: 'var(--ff-text-2)' }}>
            Don't have an account?{' '}
            <Link to="/signup" className="font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              Sign up
            </Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
