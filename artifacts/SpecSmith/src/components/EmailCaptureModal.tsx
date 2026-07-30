import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, X } from 'lucide-react';
import { saveEmailCapture, dismissEmailCaptureForever } from '../lib/emailCapture';
import { useToast } from '../context/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  buildId: string;
}

export default function EmailCaptureModal({ open, onClose, buildId }: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 400));
    saveEmailCapture(email.trim(), buildId);
    dismissEmailCaptureForever();
    setSubmitting(false);
    showToast("Thanks! We'll keep this build on file.", 'success');
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ backgroundColor: 'var(--ff-modal-bg)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--ff-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                  <Mail size={15} className="text-white" />
                </div>
                <h3 className="font-bold text-base" style={{ color: 'var(--ff-text)' }}>Want us to email you this build?</h3>
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg flex-shrink-0" style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                <X size={16} />
              </button>
            </div>

            <p className="text-xs mb-4" style={{ color: 'var(--ff-text-2)' }}>
              Totally optional — we'll just keep a copy handy. No spam, ever.
            </p>

            <div className="space-y-3">
              <input
                type="email"
                className="ff-input"
                aria-label="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={e => { if (e.key === 'Enter' && isValid) handleSubmit(); }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-80"
                  style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}
                >
                  No thanks
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!isValid || submitting}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                >
                  {submitting ? 'Saving...' : 'Email it to me'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
