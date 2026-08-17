import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Save, Trash2, Eye, EyeOff, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AVATAR_PERSONAS } from '../lib/avatars';
import UserAvatar from '../components/UserAvatar';
import PageGlow from '../components/PageGlow';

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const PRESETS = ['low', 'medium', 'high', 'ultra'];

export default function Settings() {
  const { user, loading, updateSettings, changePassword, deleteAccount } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [resolution, setResolution] = useState('1080p');
  const [preset, setPreset] = useState('high');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // The initial session/profile fetch is async, so `user` isn't available
  // on first render — these fields hydrate once it resolves, keyed on
  // user.id (not the whole `user` object) so they don't get stomped by
  // in-progress edits every time a save reloads the profile.
  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email);
      setResolution(user.preferredResolution);
      setPreset(user.preferredPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Without this, a real logged-in user gets bounced straight to /login on
  // every visit/refresh, since `user` is still null during that same async
  // check — the redirect must wait for it to resolve either way.
  if (loading) {
    return <div className="min-h-screen pt-24" />;
  }

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleSaveProfile = async () => {
    if (!username.trim() || !email.trim()) return;
    const result = await updateSettings({ username: username.trim(), email: email.trim(), preferredResolution: resolution, preferredPreset: preset });
    if (!result.ok) { showToast(result.error ?? 'Username or email already taken', 'error'); return; }
    if (result.emailChangePending) {
      showToast(`Settings saved! Check ${email.trim()} for a link to confirm your new email — your old email stays active until then.`, 'info');
    } else {
      showToast('Settings saved!', 'success');
    }
  };

  const handleChangePassword = async () => {
    if (newPw.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
    if (!/[0-9]/.test(newPw)) { showToast('Password must contain a number', 'error'); return; }
    if (!/[A-Z]/.test(newPw)) { showToast('Password must contain an uppercase letter', 'error'); return; }
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return; }
    const result = await changePassword(currentPw, newPw);
    if (!result.ok) { showToast(result.error ?? 'Could not change password', 'error'); return; }
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    showToast('Password changed!', 'success');
  };

  const handlePickAvatar = async (id: string) => {
    const result = await updateSettings({ avatar: id });
    if (result.ok) showToast('Avatar updated!', 'success');
    else showToast(result.error ?? 'Could not update avatar', 'error');
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== 'DELETE') { showToast('Type DELETE to confirm', 'warning'); return; }
    const result = await deleteAccount();
    if (!result.ok) { showToast(result.error ?? 'Could not delete account', 'error'); return; }
    navigate('/');
    showToast('Account deleted', 'info');
  };

  const sectionClass = "rounded-2xl p-6 mb-4";
  const sectionStyle = { backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' };
  const labelClass = "block text-xs font-medium mb-1.5";

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow />
      <div className="relative max-w-2xl mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-black mb-6" style={{ color: 'var(--ff-text)' }}>
            Account <span className="gradient-text">Settings</span>
          </h1>

          {/* Profile */}
          <div className={sectionClass} style={sectionStyle}>
            <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Profile</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="settings-username" className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Username</label>
                <input id="settings-username" className="ff-input" value={username} onChange={e => setUsername(e.target.value)} />
              </div>
              <div>
                <label htmlFor="settings-email" className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Email</label>
                <input id="settings-email" className="ff-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
            <button onClick={handleSaveProfile}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white"
              style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
              <Save size={14} /> Save Profile
            </button>
          </div>

          {/* Avatar */}
          <div className={sectionClass} style={sectionStyle}>
            <h2 className="font-bold mb-1" style={{ color: 'var(--ff-text)' }}>Avatar</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--ff-text-2)' }}>Pick a persona to represent you around the site.</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {AVATAR_PERSONAS.map(p => {
                const selected = user.avatar === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handlePickAvatar(p.id)}
                    title={`${p.name} — ${p.tagline}`}
                    className="flex items-center justify-center p-3 rounded-xl transition-all hover:scale-[1.03]"
                    style={{
                      backgroundColor: 'var(--ff-card)',
                      border: selected ? '2px solid var(--ff-accent)' : '2px solid transparent',
                      boxShadow: selected ? '0 0 0 1px var(--ff-accent), 0 4px 16px -4px rgba(108,99,255,0.35)' : 'none',
                    }}
                  >
                    <div className="relative">
                      <UserAvatar username={user.username} avatar={p.id} size={44} />
                      {selected && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center bg-[#00E676]">
                          <Check size={10} className="text-black" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preferences */}
          <div className={sectionClass} style={sectionStyle}>
            <h2 className="font-bold mb-4" style={{ color: 'var(--ff-text)' }}>FPS Estimator Preferences</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="settings-resolution" className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Default Resolution</label>
                <select
                  id="settings-resolution"
                  className="ff-input"
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="settings-preset" className={labelClass} style={{ color: 'var(--ff-text-2)' }}>Default Quality Preset</label>
                <select
                  id="settings-preset"
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
                { id: 'settings-current-pw', label: 'Current Password', val: currentPw, set: setCurrentPw, show: showCurrentPw, toggle: setShowCurrentPw },
                { id: 'settings-new-pw', label: 'New Password', val: newPw, set: setNewPw, show: showNewPw, toggle: setShowNewPw },
                { id: 'settings-confirm-pw', label: 'Confirm New Password', val: confirmPw, set: setConfirmPw, show: showNewPw, toggle: () => {} },
              ].map(f => (
                <div key={f.label}>
                  <label htmlFor={f.id} className={labelClass} style={{ color: 'var(--ff-text-2)' }}>{f.label}</label>
                  <div className="relative">
                    <input
                      id={f.id}
                      type={f.show ? 'text' : 'password'}
                      className="ff-input pr-10"
                      value={f.val}
                      onChange={e => f.set(e.target.value)}
                      placeholder="••••••••"
                    />
                    {f.label !== 'Confirm New Password' && (
                      <button type="button" onClick={() => f.toggle((v: boolean) => !v)}
                        aria-label={f.show ? 'Hide password' : 'Show password'}
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
            <h2 className="font-bold mb-2" style={{ color: 'var(--ff-red)' }}>Danger Zone</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--ff-text-2)' }}>
              Deleting your account is permanent. All saved builds and data will be lost.
            </p>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm"
                style={{ backgroundColor: '#FF174418', color: 'var(--ff-red)', border: '1px solid #FF174440' }}>
                <Trash2 size={14} /> Delete Account
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium" style={{ color: 'var(--ff-text)' }}>
                  Type <code className="font-mono font-bold" style={{ color: 'var(--ff-red)' }}>DELETE</code> to confirm:
                </p>
                <input
                  className="ff-input"
                  aria-label="Type DELETE to confirm account deletion"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  style={{ borderColor: deleteInput === 'DELETE' ? '#FF1744' : undefined }}
                />
                <div className="flex gap-3">
                  <button onClick={handleDeleteAccount}
                    disabled={deleteInput !== 'DELETE'}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40"
                    style={{ backgroundColor: '#FF174418', color: 'var(--ff-red)', border: '1px solid #FF174440' }}>
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
