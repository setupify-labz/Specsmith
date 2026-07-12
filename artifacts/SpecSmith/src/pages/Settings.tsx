import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Save, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const PRESETS = ['low', 'medium', 'high', 'ultra'];

export default function Settings() {
  const { user, updateSettings, deleteAccount } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [resolution, setResolution] = useState(user?.preferredResolution ?? '1080p');
  const [preset, setPreset] = useState(user?.preferredPreset ?? 'high');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleSaveProfile = () => {
    if (!username.trim() || !email.trim()) return;
    const ok = updateSettings({ username: username.trim(), email: email.trim(), preferredResolution: resolution, preferredPreset: preset });
    if (ok) showToast('Settings saved!', 'success');
    else showToast('Username or email already taken', 'error');
  };

  const handleChangePassword = () => {
    if (currentPw !== user.password) { showToast('Current password is incorrect', 'error'); return; }
    if (newPw.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
    if (!/[0-9]/.test(newPw)) { showToast('Password must contain a number', 'error'); return; }
    if (!/[A-Z]/.test(newPw)) { showToast('Password must contain an uppercase letter', 'error'); return; }
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return; }
    updateSettings({ password: newPw });
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    showToast('Password changed!', 'success');
  };

  const handleDeleteAccount = () => {
    if (deleteInput !== 'DELETE') { showToast('Type DELETE to confirm', 'warning'); return; }
    deleteAccount();
    navigate('/');
    showToast('Account deleted', 'info');
  };

  const sectionClass = "rounded-2xl p-6 mb-4";
  const sectionStyle = { backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' };
  const labelClass = "block text-xs font-medium mb-1.5";

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-2xl mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-black mb-6" style={{ color: 'var(--ff-text)' }}>
            Account <span className="gradient-text">Settings</span>
          </h1>

          {/* Profile */}
          <div className={sectionClass} style={sectionStyle}>
            <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Profile</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Username</label>
                <input className="ff-input" value={username} onChange={e => setUsername(e.target.value)} />
              </div>
              <div>
                <label className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Email</label>
                <input className="ff-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
            <button onClick={handleSaveProfile}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
              <Save size={14} /> Save Profile
            </button>
          </div>

          {/* Preferences */}
          <div className={sectionClass} style={sectionStyle}>
            <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>FPS Estimator Preferences</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Default Resolution</label>
                <select
                  className="ff-input"
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Default Quality Preset</label>
                <select
                  className="ff-input"
                  value={preset}
                  onChange={e => setPreset(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  {PRESETS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <button onClick={handleSaveProfile}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
              <Save size={14} /> Save Preferences
            </button>
          </div>

          {/* Change password */}
          <div className={sectionClass} style={sectionStyle}>
            <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Change Password</h2>
            <div className="space-y-3 mb-4">
              {[
                { label: 'Current Password', val: currentPw, set: setCurrentPw, show: showCurrentPw, toggle: setShowCurrentPw },
                { label: 'New Password', val: newPw, set: setNewPw, show: showNewPw, toggle: setShowNewPw },
                { label: 'Confirm New Password', val: confirmPw, set: setConfirmPw, show: showNewPw, toggle: () => {} },
              ].map(f => (
                <div key={f.label}>
                  <label className={labelClass} style={{ color: 'var(--ff-text-2)' }}>{f.label}</label>
                  <div className="relative">
                    <input
                      type={f.show ? 'text' : 'password'}
                      className="ff-input pr-10"
                      value={f.val}
                      onChange={e => f.set(e.target.value)}
                      placeholder="••••••••"
                    />
                    {f.label !== 'Confirm New Password' && (
                      <button type="button" onClick={() => f.toggle((v: boolean) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }}>
                        {f.show ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={handleChangePassword}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
              <Save size={14} /> Change Password
            </button>
          </div>

          {/* Danger zone */}
          <div className={sectionClass} style={{ ...sectionStyle, border: '1px solid rgba(255,23,68,0.3)' }}>
            <h2 className="font-bold mb-2" style={{ color: '#FF1744' }}>Danger Zone</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
              Deleting your account is permanent. All saved builds and data will be lost.
            </p>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm"
                style={{ backgroundColor: '#FF174418', color: '#FF1744', border: '1px solid #FF174440' }}>
                <Trash2 size={14} /> Delete Account
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium" style={{ color: 'var(--ff-text)' }}>
                  Type <code className="font-mono font-bold" style={{ color: '#FF1744' }}>DELETE</code> to confirm:
                </p>
                <input
                  className="ff-input"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  style={{ borderColor: deleteInput === 'DELETE' ? '#FF1744' : undefined }}
                />
                <div className="flex gap-3">
                  <button onClick={handleDeleteAccount}
                    disabled={deleteInput !== 'DELETE'}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40"
                    style={{ backgroundColor: '#FF174418', color: '#FF1744', border: '1px solid #FF174440' }}>
                    <Trash2 size={14} /> Confirm Delete
                  </button>
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="px-5 py-2.5 rounded-xl font-semibold text-sm"
                    style={{ color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
