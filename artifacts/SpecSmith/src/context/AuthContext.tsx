import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured, setRememberSession, type ProfileRow, type SavedBuildRow } from '../lib/supabase';
import { detectLegacyAccount, clearMigratedLegacyData, type LegacyAccount } from '../lib/authMigration';

// Real accounts: Supabase Auth (email/password) + two RLS-scoped tables
// (profiles, saved_builds — see supabase-schema.sql). Session persistence
// and refresh are handled entirely by supabase-js itself; this context is
// a thin wrapper that keeps React state in sync with it and layers the
// app's own profile/build data on top.
//
// Retired: AuthContext.legacy.tsx (the old localStorage/plaintext-password
// version). Kept in the tree, unused, as a one-cycle rollback reference —
// see its own header comment.

export interface User {
  id: string;
  username: string;
  email: string;
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

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export interface SignupResult extends AuthResult {
  /** True when Supabase requires email confirmation before this account
   * can log in — the UI should show a "check your email" state instead of
   * navigating straight to the dashboard. */
  needsEmailConfirmation?: boolean;
}

export interface SaveBuildResult extends AuthResult {
  buildId?: string;
}

export interface UpdateSettingsResult extends AuthResult {
  /** True when an email change was requested — Supabase sends a
   * confirmation link and the address on file doesn't change until it's
   * clicked, so the UI should say so instead of implying it's already live. */
  emailChangePending?: boolean;
}

export interface MigrationResult {
  ok: boolean;
  migratedCount: number;
  remainingCount: number;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  builds: SavedBuild[];
  /** True while the initial session/profile/builds load is in flight, so
   * pages can show a loading state instead of flashing a "please log in"
   * screen before the real session is known. */
  loading: boolean;
  /** False when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY aren't set —
   * same underlying check the Gallery already uses. Every method below is
   * a safe no-op returning a clear error in that state, never a crash. */
  authAvailable: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<AuthResult>;
  signup: (username: string, email: string, password: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  completePasswordReset: (newPassword: string) => Promise<AuthResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  saveBuild: (name: string, notes: string, buildState: Record<string, string | null>) => Promise<SaveBuildResult>;
  deleteBuild: (id: string) => Promise<AuthResult>;
  renameBuild: (id: string, name: string) => Promise<AuthResult>;
  shareBuild: (id: string) => Promise<void>;
  updateSettings: (data: { username?: string; email?: string; avatar?: string; preferredResolution?: string; preferredPreset?: string }) => Promise<UpdateSettingsResult>;
  deleteAccount: () => Promise<AuthResult>;
  isUsernameTaken: (username: string) => Promise<boolean>;
  /** Legacy localStorage data detected in this browser, if any — null once
   * there's nothing left to migrate. Never auto-populated with stale data:
   * re-checked after every successful (partial or full) migration. */
  legacyAccount: LegacyAccount | null;
  migrateLegacyBuilds: () => Promise<MigrationResult>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

const NOT_CONFIGURED_ERROR = 'Accounts aren\'t set up for this deployment yet.';

function rowToUser(profile: ProfileRow, email: string): User {
  return {
    id: profile.id,
    username: profile.username,
    email,
    preferredResolution: profile.preferred_resolution,
    preferredPreset: profile.preferred_preset,
    createdAt: profile.created_at,
    avatar: profile.avatar ?? undefined,
  };
}

function rowToBuild(row: SavedBuildRow): SavedBuild {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    buildState: row.build_state,
    savedAt: row.created_at,
    sharedCount: row.shared_count,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [builds, setBuilds] = useState<SavedBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [legacyAccount, setLegacyAccount] = useState<LegacyAccount | null>(null);

  const loadBuilds = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('saved_builds')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setBuilds((data as SavedBuildRow[] | null)?.map(rowToBuild) ?? []);
  }, []);

  const loadUser = useCallback(async (userId: string, email: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error || !data) {
      setUser(null);
      return;
    }
    setUser(rowToUser(data as ProfileRow, email));
    await loadBuilds(userId);
  }, [loadBuilds]);

  useEffect(() => {
    // Re-checked on mount and after every migration — legacy data is only
    // ever read here, never assumed still present from a previous render.
    setLegacyAccount(detectLegacyAccount());

    if (!supabase) {
      setLoading(false);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUser(session.user.id, session.user.email ?? '');
      } else {
        setUser(null);
        setBuilds([]);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true): Promise<AuthResult> => {
    if (!supabase) return { ok: false, error: NOT_CONFIGURED_ERROR };
    setRememberSession(remember);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const signup = useCallback(async (username: string, email: string, password: string): Promise<SignupResult> => {
    if (!supabase) return { ok: false, error: NOT_CONFIGURED_ERROR };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) return { ok: false, error: error.message };
    // With email confirmation required (see supabase-schema.sql / Supabase
    // dashboard auth settings), signUp succeeds but returns no session —
    // the account exists but can't log in until the link is clicked.
    const needsEmailConfirmation = !data.session;
    return { ok: true, needsEmailConfirmation };
  }, []);

  const logout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setBuilds([]);
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, error: NOT_CONFIGURED_ERROR };
    // Without an explicit redirectTo, Supabase falls back to the project's
    // configured Site URL, which may not point at a page that can actually
    // complete the reset. /reset-password is that page — see ResetPassword.tsx.
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const completePasswordReset = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, error: NOT_CONFIGURED_ERROR };
    // Only reachable with an active session — either a normal login or the
    // temporary one Supabase establishes from the emailed reset link, which
    // is itself the proof of identity here, so no current-password check
    // (unlike changePassword below, used from Settings by an already-known user).
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
    if (!supabase || !user) return { ok: false, error: NOT_CONFIGURED_ERROR };
    // updateUser() doesn't itself verify the *current* password, so it's
    // checked by re-authenticating with it first.
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (reauthError) return { ok: false, error: 'Current password is incorrect' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, [user]);

  const saveBuild = useCallback(async (name: string, notes: string, buildState: Record<string, string | null>): Promise<SaveBuildResult> => {
    if (!supabase || !user) return { ok: false, error: NOT_CONFIGURED_ERROR };
    if (builds.length >= 20) return { ok: false, error: 'You have reached the 20 build limit. Delete some builds first.' };
    const { data, error } = await supabase.from('saved_builds').insert({
      user_id: user.id, name, notes, build_state: buildState,
    }).select('id').single();
    if (error) return { ok: false, error: error.message.includes('saved_builds_limit_reached') ? 'You have reached the 20 build limit. Delete some builds first.' : error.message };
    await loadBuilds(user.id);
    return { ok: true, buildId: (data as { id: string }).id };
  }, [user, builds.length, loadBuilds]);

  const deleteBuild = useCallback(async (id: string): Promise<AuthResult> => {
    if (!supabase || !user) return { ok: false, error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.from('saved_builds').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    setBuilds(prev => prev.filter(b => b.id !== id));
    return { ok: true };
  }, [user]);

  const renameBuild = useCallback(async (id: string, name: string): Promise<AuthResult> => {
    if (!supabase || !user) return { ok: false, error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.from('saved_builds').update({ name }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    setBuilds(prev => prev.map(b => b.id === id ? { ...b, name } : b));
    return { ok: true };
  }, [user]);

  const shareBuild = useCallback(async (id: string) => {
    if (!supabase || !user) return;
    const build = builds.find(b => b.id === id);
    if (!build) return;
    const { error } = await supabase.from('saved_builds').update({ shared_count: build.sharedCount + 1 }).eq('id', id);
    if (!error) setBuilds(prev => prev.map(b => b.id === id ? { ...b, sharedCount: b.sharedCount + 1 } : b));
  }, [user, builds]);

  const updateSettings = useCallback(async (data: { username?: string; email?: string; avatar?: string; preferredResolution?: string; preferredPreset?: string }): Promise<UpdateSettingsResult> => {
    if (!supabase || !user) return { ok: false, error: NOT_CONFIGURED_ERROR };

    // Supabase sends a confirmation link to the new address; the email on
    // file doesn't actually change until that's clicked, so the local
    // user state is deliberately reloaded with the *current* (still-active)
    // email below, not the pending one — showing the new address as if it
    // were already live would be misleading (e.g. it'd imply the next
    // login should use it, when the old one is still required until
    // confirmed).
    const emailChangePending = Boolean(data.email && data.email !== user.email);
    if (emailChangePending) {
      const { error } = await supabase.auth.updateUser({ email: data.email });
      if (error) return { ok: false, error: error.message };
    }

    const profileUpdate: Record<string, string> = {};
    if (data.username !== undefined) profileUpdate.username = data.username;
    if (data.avatar !== undefined) profileUpdate.avatar = data.avatar;
    if (data.preferredResolution !== undefined) profileUpdate.preferred_resolution = data.preferredResolution;
    if (data.preferredPreset !== undefined) profileUpdate.preferred_preset = data.preferredPreset;

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await supabase.from('profiles').update(profileUpdate).eq('id', user.id);
      if (error) {
        return { ok: false, error: error.message.includes('duplicate key') ? 'Username already taken' : error.message };
      }
    }

    await loadUser(user.id, user.email);
    return { ok: true, emailChangePending };
  }, [user, loadUser]);

  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!supabase || !user) return { ok: false, error: NOT_CONFIGURED_ERROR };
    // The client can never delete its own auth.users row directly — that
    // needs the service-role key, which must never reach the browser. This
    // calls a Supabase Edge Function (supabase/functions/delete-account)
    // that verifies the caller's session server-side and does the real
    // deletion with that key, entirely inside Supabase's own environment.
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) return { ok: false, error: error.message };
    await supabase.auth.signOut();
    setUser(null);
    setBuilds([]);
    return { ok: true };
  }, [user]);

  const isUsernameTaken = useCallback(async (username: string): Promise<boolean> => {
    if (!supabase) return false;
    // Narrow RPC (security definer, see supabase-schema.sql) rather than a
    // public SELECT policy on profiles — returns only a boolean, never
    // exposes any other account's profile row.
    const { data, error } = await supabase.rpc('username_available', { check_username: username });
    if (error) return false;
    return data === false;
  }, []);

  const migrateLegacyBuilds = useCallback(async (): Promise<MigrationResult> => {
    if (!supabase || !user) return { ok: false, migratedCount: 0, remainingCount: 0, error: NOT_CONFIGURED_ERROR };
    const legacy = detectLegacyAccount();
    if (!legacy || legacy.builds.length === 0) {
      setLegacyAccount(null);
      return { ok: true, migratedCount: 0, remainingCount: 0 };
    }

    // Inserted one at a time (not a single bulk insert) so a build blocked
    // by the 20-build cap partway through doesn't roll back the ones
    // before it — each success is confirmed individually before its local
    // copy is ever cleared. Only the cap is treated as terminal (every
    // build after it would fail too, so there's no point continuing); any
    // other per-build error (e.g. a corrupted local build with a name/notes
    // field longer than the server allows) skips just that one build and
    // keeps trying the rest, instead of abandoning the whole migration.
    const migratedIds: string[] = [];
    const failedNames: string[] = [];
    let capReached = false;
    for (const build of legacy.builds) {
      const { error } = await supabase.from('saved_builds').insert({
        user_id: user.id, name: build.name, notes: build.notes,
        build_state: build.buildState, shared_count: build.sharedCount,
      });
      if (error) {
        if (error.message.includes('saved_builds_limit_reached')) {
          capReached = true;
          break;
        }
        failedNames.push(build.name);
        continue;
      }
      migratedIds.push(build.id);
    }

    if (migratedIds.length > 0) {
      clearMigratedLegacyData(legacy.userId, migratedIds);
      await loadBuilds(user.id);
    }

    const remaining = legacy.builds.length - migratedIds.length;
    setLegacyAccount(remaining > 0 ? detectLegacyAccount() : null);

    let error: string | undefined;
    if (capReached) error = 'Reached the 20 build limit — delete some builds to migrate the rest.';
    else if (failedNames.length > 0) error = `Could not migrate: ${failedNames.join(', ')}`;

    return { ok: remaining === 0, migratedCount: migratedIds.length, remainingCount: remaining, error };
  }, [user, loadBuilds]);

  return (
    <AuthContext.Provider value={{
      user, builds, loading, authAvailable: isSupabaseConfigured,
      login, signup, logout, requestPasswordReset, completePasswordReset, changePassword,
      saveBuild, deleteBuild, renameBuild, shareBuild,
      updateSettings, deleteAccount, isUsernameTaken,
      legacyAccount, migrateLegacyBuilds,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
