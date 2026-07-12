import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Trash2, Edit2, Check, ExternalLink, BarChart2, Clock, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ShareButton from '../components/ShareButton';
import { getShareUrl } from '../lib/sharing';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const { user, builds, activity, deleteBuild, renameBuild } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg mb-4" style={{ color: 'var(--ff-text-2)' }}>Please log in to view your dashboard</p>
          <Link to="/login" className="px-6 py-3 rounded-xl font-bold text-white text-sm"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Log In
          </Link>
        </div>
      </div>
    );
  }

  const gpuCounts: Record<string, number> = {};
  builds.forEach(b => {
    const g = b.buildState.gpu;
    if (g) gpuCounts[g] = (gpuCounts[g] ?? 0) + 1;
  });
  const mostUsedGpu = Object.entries(gpuCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  const totalShared = builds.reduce((s, b) => s + b.sharedCount, 0);

  const startEdit = (id: string, name: string) => { setEditingId(id); setEditName(name); };
  const commitEdit = (id: string) => {
    if (editName.trim()) renameBuild(id, editName.trim());
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      deleteBuild(id);
      setDeleteConfirm(null);
      showToast('Build deleted', 'info');
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(c => c === id ? null : c), 3000);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>
            Welcome back, <span className="gradient-text">{user.username}</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Manage your saved builds and preferences</p>
        </motion.div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Builds Saved', value: builds.length, icon: <Cpu size={18} />, color: 'var(--ff-accent)' },
            { label: 'Builds Shared', value: totalShared, icon: <ExternalLink size={18} />, color: 'var(--ff-cyan)' },
            { label: 'Most Used GPU', value: mostUsedGpu.replace(/-/g, ' ').toUpperCase().slice(0, 10), icon: <BarChart2 size={18} />, color: '#00E676' },
            { label: 'Total Builds', value: `${builds.length}/20`, icon: <Zap size={18} />, color: '#FFB300' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              <div className="flex items-center gap-2 mb-1" style={{ color: stat.color }}>
                {stat.icon}
                <span className="text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>{stat.label}</span>
              </div>
              <p className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Builds grid */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ff-text)' }}>My Builds</h2>

            {builds.length === 0 ? (
              <div className="rounded-2xl p-12 text-center"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <div className="text-5xl mb-4">🖥️</div>
                <p className="font-semibold mb-2" style={{ color: 'var(--ff-text)' }}>No builds saved yet</p>
                <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>Start building your dream PC and save it here</p>
                <Link to="/builder"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white"
                  style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                  Start Building →
                </Link>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <AnimatePresence>
                  {builds.map((build, i) => (
                    <motion.div
                      key={build.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.05 }}
                      className="rounded-xl p-4"
                      style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
                    >
                      {/* Build name (editable) */}
                      {editingId === build.id ? (
                        <div className="flex gap-2 mb-3">
                          <input
                            className="ff-input flex-1 text-sm"
                            style={{ height: 32 }}
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(build.id); if (e.key === 'Escape') setEditingId(null); }}
                            autoFocus
                          />
                          <button onClick={() => commitEdit(build.id)} className="p-1.5 rounded-lg" style={{ color: '#00E676', backgroundColor: '#00E67612' }}>
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="font-bold text-sm flex-1 truncate" style={{ color: 'var(--ff-text)' }}>{build.name}</h3>
                          <button onClick={() => startEdit(build.id, build.name)} style={{ color: 'var(--ff-text-3)' }}>
                            <Edit2 size={13} />
                          </button>
                        </div>
                      )}

                      <div className="space-y-1 text-xs mb-3" style={{ color: 'var(--ff-text-2)' }}>
                        {build.buildState.gpu && <p>GPU: <span style={{ color: 'var(--ff-text)' }}>{build.buildState.gpu.replace(/-/g,' ')}</span></p>}
                        {build.buildState.cpu && <p>CPU: <span style={{ color: 'var(--ff-text)' }}>{build.buildState.cpu.replace(/-/g,' ')}</span></p>}
                        <p className="flex items-center gap-1" style={{ color: 'var(--ff-text-3)' }}>
                          <Clock size={10} />{formatDate(build.savedAt)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => navigate(`/builder?b=${btoa(JSON.stringify(build.buildState))}`)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1"
                          style={{ backgroundColor: `${getComputedStyle(document.documentElement).getPropertyValue('--ff-accent') || '#6C63FF'}18`, color: 'var(--ff-accent)' }}
                        >
                          <Cpu size={11} /> Load
                        </button>
                        <ShareButton buildState={build.buildState} buildName={build.name} buildId={build.id} size="sm" />
                        <button
                          onClick={() => handleDelete(build.id)}
                          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg"
                          style={{
                            color: deleteConfirm === build.id ? '#FF1744' : 'var(--ff-text-3)',
                            backgroundColor: deleteConfirm === build.id ? '#FF174418' : 'var(--ff-card)',
                            border: deleteConfirm === build.id ? '1px solid #FF174440' : '1px solid transparent',
                          }}
                        >
                          {deleteConfirm === build.id ? 'Confirm?' : <Trash2 size={12} />}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Activity feed */}
          <div>
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ff-text)' }}>Recent Activity</h2>
            <div className="rounded-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
              {activity.length === 0 ? (
                <p className="p-6 text-sm text-center" style={{ color: 'var(--ff-text-2)' }}>No activity yet</p>
              ) : (
                activity.slice(0, 8).map((act, i) => (
                  <div key={act.id} className="px-4 py-3"
                    style={{ borderBottom: i < Math.min(activity.length - 1, 7) ? '1px solid var(--ff-border)' : undefined }}>
                    <p className="text-sm" style={{ color: 'var(--ff-text)' }}>{act.message}</p>
                    <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--ff-text-3)' }}>
                      <Clock size={10} />{formatTime(act.time)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
