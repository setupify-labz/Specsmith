// One-time migration of pre-Supabase localStorage accounts/builds into a
// real account. There is no way to automatically log a local account into
// a new Supabase account — the old passwords were never hashed compatibly
// with anything Supabase can verify, and a localStorage "account" has no
// cryptographic identity to carry over. The only honest path is manual and
// opt-in: detect old data, tell the person clearly, let them sign in/up for
// real, then copy their builds over — never deleting the local copy until
// each build is confirmed to have made it to Supabase.

export interface LegacyBuild {
  id: string;
  name: string;
  notes: string;
  buildState: Record<string, string | null>;
  sharedCount: number;
}

export interface LegacyAccount {
  userId: string;
  username: string;
  builds: LegacyBuild[];
}

function safeParse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Reads whatever legacy session + builds exist in this browser, if any.
 * Read-only — never modifies or clears anything. */
export function detectLegacyAccount(): LegacyAccount | null {
  try {
    const session = safeParse<{ id: string; username: string }>(localStorage.getItem('specsmith-session'));
    if (!session?.id) return null;
    const builds = safeParse<LegacyBuild[]>(localStorage.getItem(`specsmith-builds-${session.id}`)) ?? [];
    return { userId: session.id, username: session.username ?? 'your old account', builds };
  } catch {
    return null;
  }
}

/** Removes only the specific legacy builds passed in (by id) from this
 * browser's local storage, plus the legacy session/user-list entry if and
 * only if every one of that account's builds was migrated. Never called
 * with builds that haven't been confirmed to exist in Supabase first —
 * see AuthContext.tsx's migrateLegacyBuilds. */
export function clearMigratedLegacyData(userId: string, migratedBuildIds: string[]): void {
  try {
    const key = `specsmith-builds-${userId}`;
    const remaining = (safeParse<LegacyBuild[]>(localStorage.getItem(key)) ?? [])
      .filter(b => !migratedBuildIds.includes(b.id));

    if (remaining.length > 0) {
      // Some builds (e.g. blocked by the 20-build cap) weren't migrated —
      // keep them and the account so the prompt can offer to finish later.
      localStorage.setItem(key, JSON.stringify(remaining));
      return;
    }

    // Everything for this account migrated — safe to fully clear it.
    localStorage.removeItem(key);
    localStorage.removeItem(`specsmith-activity-${userId}`);
    localStorage.removeItem('specsmith-session');
    const users = safeParse<{ id: string }[]>(localStorage.getItem('specsmith-users')) ?? [];
    localStorage.setItem('specsmith-users', JSON.stringify(users.filter(u => u.id !== userId)));
  } catch {
    // localStorage unavailable — nothing to clear, nothing to lose either.
  }
}

/** Dismissing the prompt for this browser session only (sessionStorage,
 * not localStorage) — the legacy data itself is untouched, so the prompt
 * comes back on the next visit until it's actually migrated or the
 * legacy data is gone. Never a way to make the reminder disappear
 * permanently without either migrating or losing the data some other way
 * (clearing site data) — that's intentional per the "must stay prominent
 * until resolved" requirement. */
const DISMISS_KEY = 'specsmith-legacy-migration-dismissed';

export function isMigrationPromptDismissedThisSession(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function dismissMigrationPromptThisSession(): void {
  try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
}
