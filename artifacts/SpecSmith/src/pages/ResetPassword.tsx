import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import PageGlow from '../components/PageGlow';

function validatePassword(v: string) {
  if (!v) return 'Password is required';
  if (v.length < 8) return 'At least 8 characters';
  if (!/[0-9]/.test(v)) return 'Must contain a number';
  if (!/[A-Z]/.test(v)) return 'Must contain an uppercase letter';
  return '';
}

// Landing page for the link in the "forgot password" email (see
// AuthContext.tsx's requestPasswordReset, which points redirectTo here).
// Clicking that link gives the browser a temporary Supabase session before
// this page ever mounts — that session itself is the proof of identity, so
// completePasswordReset doesn't ask for the old password (unlike Settings'
// regular change-password flow, used by someone who already knows it).
//
// The heading and outer shell always render, with only the body swapping
// between loading/expired/form — this page is prerendered (see
// entry-server.tsx), and the async session check never resolves during
// that static render, so gating the whole page (including the heading) on
// it would prerender to empty content on every build.
export default function ResetPassword() {
  const { user, loading, completePasswordReset } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Guards every branch below that depends on `user`/`loading` so the very
  // first client paint is provably identical to the prerendered HTML no
  // matter how fast the auth check resolves — `mounted` can only flip via
  // an effect, which by definition can't run before hydration's initial
  // comparison completes, unlike `loading`/`user` which (empirically) was
  // resolving fast enough client-side to cause a React #418 hydration
  // mismatch against the static markup.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const showLoading = !mounted || loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwError = validatePassword(newPw);
    if (pwError) { setError(pwError); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }

    setSubmitting(true);
    const result = await completePasswordReset(newPw);
    setSubmitting(false);
    if (!result.ok) { setError(result.error ?? 'Could not reset password'); return; }
    showToast('Password reset! You\'re logged in.', 'success');
    navigate('/dashboard');
  };

  return (
    <div className="relative min-h-screen pt-20 flex items-center justify-center px-4" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow />
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>
            Set a <span className="gradient-text">New Password</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
            {!showLoading && user ? `Choose a new password for ${user.email}` : 'Follow the link from your password reset email to continue'}
          </p>
        </div>

        {showLoading ? (
          <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <span className="inline-block w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--ff-border)', borderTopColor: 'var(--ff-accent)' }} />
          </div>
        ) : !user ? (
          <div className="rounded-2xl p-8 text-center space-y-4" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
              This password reset link is invalid or has expired. Request a new one from the login page.
            </p>
            <Link to="/login" className="inline-block font-semibold text-sm hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              Back to Log In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl p-8 space-y-4"
            style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>

            {error && (
              <div className="px-4 py-3 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#FF174418', color: 'var(--ff-red)', border: '1px solid #FF174440' }}>
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ff-text-2)' }}>New Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }} />
                <input
                  type={showPw ? 'text' : 'password'}
                  className={`ff-input pl-9 pr-10 ${error ? 'error' : ''}`}
                  value={newPw}
                  onChange={e => { setNewPw(e.target.value); setError(''); }}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ff-text-2)' }}>Confirm New Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }} />
                <input
                  type={showPw ? 'text' : 'password'}
                  className={`ff-input pl-9 ${error ? 'error' : ''}`}
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setError(''); }}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
            >
              {submitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          : <KeyRound size={15} />}
              {submitting ? 'Saving...' : 'Set New Password'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
