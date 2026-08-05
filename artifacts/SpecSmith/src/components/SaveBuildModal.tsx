import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, LogIn, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import EmailCaptureModal from './EmailCaptureModal';

interface Props {
  open: boolean;
  onClose: () => void;
  buildState: Record<string, string | null>;
}

export default function SaveBuildModal({ open, onClose, buildState }: Props) {
  const { user, builds, saveBuild } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailCaptureBuildId, setEmailCaptureBuildId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setName(`My Build #${(builds.length + 1)}`);
  }, [open, builds.length]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    const beforeIds = new Set(builds.map(b => b.id));
    const ok = saveBuild(name.trim(), notes.trim(), buildState);
    setSaving(false);
    if (ok) {
      showToast('Build saved!', 'success', { label: 'View in Dashboard', onClick: () => navigate('/dashboard') });
      onClose();
      // Grab the newly created build's id (most recent, not present before save) to offer the optional email capture.
      const savedBuilds = JSON.parse(localStorage.getItem(`specsmith-builds-${user?.id}`) || '[]') as { id: string }[];
      const newBuild = savedBuilds.find(b => !beforeIds.has(b.id));
      if (newBuild) setEmailCaptureBuildId(newBuild.id);
    } else if (builds.length >= 20) {
      showToast('You have reached the 20 build limit. Delete some builds first.', 'error');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: 'var(--ff-modal-bg)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--ff-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg" style={{ color: 'var(--ff-text)' }}>Save Build</h3>
              <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg" style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                <X size={16} />
              </button>
            </div>

            {!user ? (
              <div className="text-center py-4">
                <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>Create a free account to save builds and access them anywhere.</p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => { onClose(); navigate('/signup'); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm text-white"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                  >
                    <UserPlus size={15} />
                    Sign Up Free
                  </button>
                  <button
                    onClick={() => { onClose(); navigate('/login'); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm"
                    style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
                  >
                    <LogIn size={15} />
                    Log In
                  </button>
                </div>
              </div>
            ) : (
              <>
                {builds.length >= 18 && builds.length < 20 && (
                  <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: '#FFB30018', color: 'var(--ff-amber)', border: '1px solid #FFB30040' }}>
                    You have {builds.length}/20 builds saved. You're almost at the limit.
                  </div>
                )}
                <div className="space-y-4">
                  <div>
                    <label htmlFor="save-build-name" className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ff-text-2)' }}>Build Name</label>
                    <input
                      id="save-build-name"
                      className="ff-input"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="My Awesome Build"
                      maxLength={60}
                    />
                  </div>
                  <div>
                    <label htmlFor="save-build-notes" className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ff-text-2)' }}>Notes <span style={{ color: 'var(--ff-text-3)' }}>(optional)</span></label>
                    <textarea
                      id="save-build-notes"
                      className="ff-input"
                      style={{ height: 80, resize: 'none', paddingTop: 10, paddingBottom: 10 }}
                      value={notes}
                      onChange={e => setNotes(e.target.value.slice(0, 200))}
                      placeholder="Notes about this build..."
                    />
                    <p className="text-[10px] text-right mt-0.5" style={{ color: 'var(--ff-text-3)' }}>{notes.length}/200</p>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={!name.trim() || saving}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
                  >
                    {saving ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                    ) : (
                      <><Save size={15} /> Save Build</>
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
      <EmailCaptureModal
        open={emailCaptureBuildId !== null}
        onClose={() => setEmailCaptureBuildId(null)}
        buildId={emailCaptureBuildId ?? ''}
      />
    </AnimatePresence>
  );
}
