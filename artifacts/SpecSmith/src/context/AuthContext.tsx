import { createContext, useContext, useState, useCallback, useEffect } from 'react';

// SECURITY (audited, not fixed — no backend exists to fix it with): this
// entire module is a client-only, localStorage-backed demo auth system.
// Passwords are stored and compared in plaintext, in the browser, with no
// hashing — that is fundamentally not something you can harden client-side;
// it needs a real backend. Do not present this as production-grade
// authentication anywhere in the product.
//
// What this means concretely:
// - Anyone with access to the browser (devtools, another extension, a
//   compromised machine) can read every user's plaintext password directly
//   out of localStorage['specsmith-users'].
// - There is no session expiry — a session lives until explicit logout.
// - "Login" is just an array scan comparing plaintext strings; there is no
//   protection against automated guessing since it never leaves the client.
//
// Migration path before real accounts should be enabled: this repo already
// has a working Supabase project (see src/lib/supabase.ts) used ONLY for
// the anonymous public build gallery today — no Supabase Auth is wired up.
// The real fix is: add Supabase Auth (or an equivalent backend), move
// signup/login to it (hashed passwords, real sessions/JWTs, never expose a
// password hash to the client), keep `users`/`saved builds` in Postgres
// tables keyed by the authenticated user's id with RLS policies instead of
// localStorage, and migrate this context to be a thin wrapper over that
// client SDK instead of the getUsers/setUsers helpers below. Until that
// lands, treat every account created here as a local-only demo account.

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  preferredResolution: string;
  preferredPreset: string;
  createdAt: string;
  avatar?: string;
}

export interface SavedBuild {
  id: string;
  name: string;
  notes: string;
  buildState: Record<string, string | null>;
  savedAt: string;
  sharedCount: number;
}

export interface Activity {
  id: string;
  message: string;
  time: string;
}

interface AuthContextType {
  user: User | null;
  builds: SavedBuild[];
  activity: Activity[];
  login: (email: string, password: string) => boolean;
  signup: (username: string, email: string, password: string) => boolean;
  logout: () => void;
  saveBuild: (name: string, notes: string, buildState: Record<string, string | null>) => boolean;
  deleteBuild: (id: string) => void;
  renameBuild: (id: string, name: string) => void;
  shareBuild: (id: string) => void;
  updateSettings: (data: Partial<User>) => boolean;
  deleteAccount: () => void;
  isEmailTaken: (email: string) => boolean;
  isUsernameTaken: (username: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

function getUsers(): User[] {
  try { return JSON.parse(localStorage.getItem('specsmith-users') || '[]'); } catch { return []; }
}
function setUsers(u: User[]) {
  localStorage.setItem('specsmith-users', JSON.stringify(u));
}
function getSession(): User | null {
  try { return JSON.parse(localStorage.getItem('specsmith-session') || 'null'); } catch { return null; }
}
function setSession(u: User | null) {
  if (u) localStorage.setItem('specsmith-session', JSON.stringify(u));
  else localStorage.removeItem('specsmith-session');
}
function getUserBuilds(userId: string): SavedBuild[] {
  try { return JSON.parse(localStorage.getItem(`specsmith-builds-${userId}`) || '[]'); } catch { return []; }
}
function setUserBuilds(userId: string, builds: SavedBuild[]) {
  localStorage.setItem(`specsmith-builds-${userId}`, JSON.stringify(builds));
}
function getUserActivity(userId: string): Activity[] {
  try { return JSON.parse(localStorage.getItem(`specsmith-activity-${userId}`) || '[]'); } catch { return []; }
}
function addActivity(userId: string, message: string) {
  const acts = getUserActivity(userId);
  acts.unshift({ id: crypto.randomUUID(), message, time: new Date().toISOString() });
  localStorage.setItem(`specsmith-activity-${userId}`, JSON.stringify(acts.slice(0, 20)));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Start signed-out on every render — matching the server, which has no
  // localStorage — then hydrate the real session right after mount below.
  // Reading getSession() straight into these initializers (the old
  // approach) made a logged-in user's client's first render differ from
  // the server's, which is exactly what React reports as hydration error
  // #418 (see the identical fix in ThemeContext.tsx).
  const [user, setUser] = useState<User | null>(null);
  const [builds, setBuilds] = useState<SavedBuild[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    const s = getSession();
    if (s) {
      setUser(s);
      setBuilds(getUserBuilds(s.id));
      setActivity(getUserActivity(s.id));
    }
  }, []);

  const refreshBuilds = useCallback((u: User) => {
    setBuilds(getUserBuilds(u.id));
    setActivity(getUserActivity(u.id));
  }, []);

  const login = useCallback((email: string, password: string): boolean => {
    const users = getUsers();
    const found = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!found) return false;
    setUser(found);
    setSession(found);
    setBuilds(getUserBuilds(found.id));
    setActivity(getUserActivity(found.id));
    return true;
  }, []);

  const signup = useCallback((username: string, email: string, password: string): boolean => {
    const users = getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return false;
    const newUser: User = {
      id: crypto.randomUUID(),
      username, email, password,
      preferredResolution: '1080p',
      preferredPreset: 'high',
      createdAt: new Date().toISOString(),
    };
    setUsers([...users, newUser]);
    setUser(newUser);
    setSession(newUser);
    setBuilds([]);
    setActivity([]);
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setSession(null);
    setBuilds([]);
    setActivity([]);
  }, []);

  const saveBuild = useCallback((name: string, notes: string, buildState: Record<string, string | null>): boolean => {
    if (!user) return false;
    const current = getUserBuilds(user.id);
    if (current.length >= 20) return false;
    const newBuild: SavedBuild = {
      id: crypto.randomUUID(),
      name, notes, buildState,
      savedAt: new Date().toISOString(),
      sharedCount: 0,
    };
    const updated = [newBuild, ...current];
    setUserBuilds(user.id, updated);
    addActivity(user.id, `Saved build "${name}"`);
    setBuilds(updated);
    setActivity(getUserActivity(user.id));
    return true;
  }, [user]);

  const deleteBuild = useCallback((id: string) => {
    if (!user) return;
    const updated = getUserBuilds(user.id).filter(b => b.id !== id);
    setUserBuilds(user.id, updated);
    setBuilds(updated);
  }, [user]);

  const renameBuild = useCallback((id: string, name: string) => {
    if (!user) return;
    const updated = getUserBuilds(user.id).map(b => b.id === id ? { ...b, name } : b);
    setUserBuilds(user.id, updated);
    setBuilds(updated);
  }, [user]);

  const shareBuild = useCallback((id: string) => {
    if (!user) return;
    const updated = getUserBuilds(user.id).map(b => b.id === id ? { ...b, sharedCount: b.sharedCount + 1 } : b);
    setUserBuilds(user.id, updated);
    const build = updated.find(b => b.id === id);
    if (build) addActivity(user.id, `Shared build "${build.name}"`);
    setBuilds(updated);
    setActivity(getUserActivity(user.id));
  }, [user]);

  const updateSettings = useCallback((data: Partial<User>): boolean => {
    if (!user) return false;
    const users = getUsers();
    if (data.username && users.find(u => u.id !== user.id && u.username.toLowerCase() === data.username!.toLowerCase())) return false;
    if (data.email && users.find(u => u.id !== user.id && u.email.toLowerCase() === data.email!.toLowerCase())) return false;
    const updated = { ...user, ...data };
    setUsers(users.map(u => u.id === user.id ? updated : u));
    setSession(updated);
    setUser(updated);
    return true;
  }, [user]);

  const deleteAccount = useCallback(() => {
    if (!user) return;
    const users = getUsers().filter(u => u.id !== user.id);
    setUsers(users);
    localStorage.removeItem(`specsmith-builds-${user.id}`);
    localStorage.removeItem(`specsmith-activity-${user.id}`);
    setSession(null);
    setUser(null);
    setBuilds([]);
    setActivity([]);
  }, [user]);

  const isEmailTaken = useCallback((email: string) => {
    return getUsers().some(u => u.email.toLowerCase() === email.toLowerCase());
  }, []);

  const isUsernameTaken = useCallback((username: string) => {
    return getUsers().some(u => u.username.toLowerCase() === username.toLowerCase());
  }, []);

  return (
    <AuthContext.Provider value={{
      user, builds, activity,
      login, signup, logout,
      saveBuild, deleteBuild, renameBuild, shareBuild,
      updateSettings, deleteAccount,
      isEmailTaken, isUsernameTaken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
