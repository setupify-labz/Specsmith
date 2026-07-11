// The app launched under the working name "FrameForge"; localStorage keys
// kept that prefix after the rename to SpecSmith. This migrates any
// remaining frameforge-* keys (including per-user frameforge-builds-<id>
// keys) to the specsmith-* prefix exactly once, preserving existing users'
// accounts, saved builds, and preferences.
export function migrateLegacyStorage(): void {
  try {
    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('frameforge-')) legacyKeys.push(key);
    }
    for (const key of legacyKeys) {
      const newKey = key.replace(/^frameforge-/, 'specsmith-');
      if (localStorage.getItem(newKey) === null) {
        const value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(newKey, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable (SSR, privacy mode) — nothing to migrate.
  }
}
