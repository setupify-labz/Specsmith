import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail, Lock, Eye, EyeOff, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PageGlow from '../components/PageGlow';

interface FieldError { username?: string; email?: string; password?: string; confirm?: string; }

function validateUsername(v: string) {
  if (!v) return 'Username is required';
  if (v.length < 3) return 'At least 3 characters';
  if (v.length > 20) return 'Max 20 characters';
  if (!/^[a-zA-Z0-9_]+$/.test(v)) return 'Only letters, numbers, underscores';
  return '';
}
function validateEmail(v: string) {
  if (!v) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Invalid email format';
  return '';
}
function validatePassword(v: string) {
  if (!v) return 'Password is required';
  if (v.length < 8) return 'At least 8 characters';
  if (!/[0-9]/.test(v)) return 'Must contain a number';
  if (!/[A-Z]/.test(v)) return 'Must contain an uppercase letter';
  return '';
}
function validateConfirm(v: string, pw: string) {
  if (!v) return 'Please confirm password';
  if (v !== pw) return 'Passwords do not match';
  return '';
}

export default function Signup() {
  const { signup, isEmailTaken, isUsernameTaken } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState({ username: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldError>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const validate = (name: string, value: string): string => {
    switch (name) {
      case 'username': {
        const e = validateUsername(value);
        if (!e && isUsernameTaken(value)) return 'Username already taken';
        return e;
      }
      case 'email': {
        const e = validateEmail(value);
        if (!e && isEmailTaken(value)) return 'Email already registered';
        return e;
      }
      case 'password': return validatePassword(value);
      case 'confirm': return validateConfirm(value, fields.password);
      default: return '';
    }
  };

  const handleChange = (name: string, value: string) => {
    const updated = { ...fields, [name]: value };
    setFields(updated);
    if (touched[name]) {
      const err = name === 'confirm'
        ? validateConfirm(value, updated.password)
        : validate(name, value);
      setErrors(prev => ({ ...prev, [name]: err }));
    }
    if (name === 'password' && touched.confirm) {
      setErrors(prev => ({ ...prev, confirm: validateConfirm(updated.confirm, value) }));
    }
  };

  const handleBlur = (name: string) => {
    setTouched(prev => ({ ...prev, [name]: true }));
    setErrors(prev => ({ ...prev, [name]: validate(name, fields[name as keyof typeof fields]) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: FieldError = {
      username: validate('username', fields.username),
      email: validate('email', fields.email),
      password: validate('password', fields.password),
      confirm: validate('confirm', fields.confirm),
    };
    setErrors(newErrors);
    setTouched({ username: true, email: true, password: true, confirm: true });
    if (Object.values(newErrors).some(Boolean)) return;

    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    const ok = signup(fields.username, fields.email, fields.password);
    setLoading(false);
    if (ok) navigate('/dashboard');
  };

  const renderField = (name: keyof typeof fields, label: string, type: string, icon: React.ReactNode, placeholder: string, extra?: React.ReactNode) => (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ff-text-2)' }}>{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ff-text-3)' }}>{icon}</span>
        <input
          type={type}
          className={`ff-input pl-9 ${extra ? 'pr-10' : ''} ${touched[name] && errors[name] ? 'error' : ''}`}
          value={fields[name]}
          onChange={e => handleChange(name, e.target.value)}
          onBlur={() => handleBlur(name)}
          placeholder={placeholder}
          required
          autoComplete={name === 'username' ? 'username' : name === 'email' ? 'email' : name === 'password' ? 'new-password' : 'new-password'}
        />
        {extra && <span className="absolute right-3 top-1/2 -translate-y-1/2">{extra}</span>}
      </div>
      {touched[name] && errors[name] && (
        <p className="text-xs mt-1" style={{ color: 'var(--ff-red)' }}>{errors[name]}</p>
      )}
    </div>
  );

  return (
    <div className="relative min-h-screen pt-20 flex items-center justify-center px-4 py-8" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="cool" />
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>
            Create <span className="gradient-text">Account</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Save builds, compare specs, share with friends</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl p-8 space-y-4"
          style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>

          {renderField('username', 'Username', 'text', <User size={15} />, 'username')}
          {renderField('email', 'Email', 'email', <Mail size={15} />, 'name@example.com')}
          {renderField('password', 'Password', showPass ? 'text' : 'password', <Lock size={15} />, '••••••••',
            <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'} style={{ color: 'var(--ff-text-3)' }}>
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {renderField('confirm', 'Confirm Password', showConfirm ? 'text' : 'password', <Lock size={15} />, '••••••••',
            <button type="button" onClick={() => setShowConfirm(!showConfirm)} aria-label={showConfirm ? 'Hide password' : 'Show password'} style={{ color: 'var(--ff-text-3)' }}>
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                     : <UserPlus size={15} />}
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="text-center text-sm" style={{ color: 'var(--ff-text-2)' }}>
            Already have an account?{' '}
            <Link to="/login" className="font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              Log in
            </Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
