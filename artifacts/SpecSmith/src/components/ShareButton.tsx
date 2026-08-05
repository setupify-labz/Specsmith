import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Check, X, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getShareUrl, type ShareView, type SharedCustomPart } from '../lib/sharing';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { hasDismissedEmailCapture, dismissEmailCaptureForever } from '../lib/emailCapture';
import EmailCaptureModal from './EmailCaptureModal';

interface Props {
  buildState: Record<string, string | null>;
  buildName?: string;
  buildId?: string;
  size?: 'sm' | 'md';
  view?: ShareView;
  customParts?: SharedCustomPart[];
}

export default function ShareButton({ buildState, buildName, buildId, size = 'md', view, customParts }: Props) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [emailCaptureOpen, setEmailCaptureOpen] = useState(false);
  const { showToast } = useToast();
  const { shareBuild } = useAuth();

  const url = getShareUrl(buildState, buildName, view, customParts);

  const markShared = () => {
    if (buildId) {
      shareBuild(buildId);
      if (!hasDismissedEmailCapture()) setEmailCaptureOpen(true);
    }
  };

  const handleCopy = async () => {
    // On mobile, prefer the OS share sheet (drop straight into Messages,
    // Mail, or any app) over a silent clipboard copy — it's the one-tap
    // path on the exact devices most people are on when sharing a build.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: buildName || 'My PC Build', url });
        markShared();
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return; // user closed the share sheet
        // any other failure (e.g. share target rejected it) — fall through to clipboard copy
      }
    }
    await copyLinkOnly();
  };

  // Always a plain clipboard copy, regardless of Web Share support — used
  // by the QR modal's "Copy link instead" fallback, which exists precisely
  // for people who don't want the share sheet.
  const copyLinkOnly = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      markShared();
      setTimeout(() => setCopied(false), 2500);
    } catch {
      showToast('Failed to copy link', 'error');
    }
  };

  const btnClass = size === 'sm'
    ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all'
    : 'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all';

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className={btnClass}
          style={{
            border: '1px solid var(--ff-accent)',
            color: copied ? 'var(--ff-green)' : 'var(--ff-accent-text)',
            borderColor: copied ? 'var(--ff-green)' : 'var(--ff-accent)',
            backgroundColor: copied ? '#00E67608' : 'transparent',
          }}
        >
          <motion.span
            key={copied ? 'check' : 'share'}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {copied ? <Check size={size === 'sm' ? 12 : 14} /> : <Share2 size={size === 'sm' ? 12 : 14} />}
          </motion.span>
          {copied ? 'Link Copied!' : 'Share Build'}
        </button>
        <button
          onClick={() => setQrOpen(true)}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}
          title="Show QR Code"
        >
          <QrCode size={size === 'sm' ? 13 : 15} />
        </button>
      </div>

      {/* QR Modal */}
      <AnimatePresence>
        {qrOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ backgroundColor: 'var(--ff-modal-bg)', backdropFilter: 'blur(4px)' }}
            onClick={() => setQrOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="rounded-2xl p-6 shadow-2xl text-center"
              style={{ backgroundColor: 'var(--ff-surface)', maxWidth: 320, width: '100%' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold" style={{ color: 'var(--ff-text)' }}>Scan to Open Build</h3>
                <button onClick={() => setQrOpen(false)} aria-label="Close" style={{ color: 'var(--ff-text-2)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="inline-block p-3 bg-white rounded-xl" role="img" aria-label="QR code linking to this build">
                <QRCodeSVG value={url} size={200} aria-hidden="true" />
              </div>
              <p className="text-xs mt-3" style={{ color: 'var(--ff-text-2)' }}>Scan with your phone to view this build</p>
              <button
                onClick={copyLinkOnly}
                className="mt-3 text-xs font-semibold"
                style={{ color: 'var(--ff-accent-text)' }}
              >
                {copied ? '✓ Copied!' : 'Copy link instead'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <EmailCaptureModal
        open={emailCaptureOpen}
        onClose={() => { dismissEmailCaptureForever(); setEmailCaptureOpen(false); }}
        buildId={buildId ?? ''}
      />
    </>
  );
}
