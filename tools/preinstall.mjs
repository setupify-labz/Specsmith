// Root preinstall guard: remove conflicting lockfiles, then enforce pnpm.
//
// WHY THIS IS NODE AND NOT A SHELL ONE-LINER
// ------------------------------------------
// This replaces:
//
//   sh -c 'rm -f package-lock.json yarn.lock; case "$npm_config_user_agent" in
//          pnpm/*) ;; *) echo "Use pnpm instead" >&2; exit 1 ;; esac'
//
// which cannot run on Windows. npm and pnpm execute lifecycle scripts through
// the platform shell — cmd.exe on Windows unless `script-shell` or pnpm's
// `shell-emulator` is configured, and this repository configures neither — so
// `sh` is looked up on PATH and is not there. Git for Windows does ship an
// sh.exe, but under `Git\bin`, which its installer does not normally add to
// PATH (it adds `Git\cmd`). The result was that `pnpm install` failed at
// preinstall, before a single dependency was fetched, on the one platform the
// measured collector actually targets: scripts/measured refuses to run
// anywhere but Windows, so "the collector supports Windows" and "you cannot
// install this repository on Windows" were shipped together.
//
// Node is the one interpreter guaranteed to be present here — npm and pnpm are
// themselves Node programs and put it on the script PATH — so a .mjs is
// portable in a way no shell snippet is.
//
// ONLY NODE BUILT-INS
// -------------------
// preinstall runs BEFORE dependencies are installed. Importing anything from
// node_modules would fail on a clean clone, which is exactly when this script
// matters most.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Lockfiles from other package managers. Their presence confuses tooling and CI. */
export const CONFLICTING_LOCKFILES = ['package-lock.json', 'yarn.lock'];

/**
 * The repository root, resolved from this file rather than from cwd.
 *
 * The shell version used bare relative paths, which depended on the package
 * manager setting cwd to the package directory. It does, but resolving from
 * the script's own location means this behaves identically however it is
 * invoked — including when a developer runs it by hand to see what it does.
 */
export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Whether the package manager running us is pnpm.
 *
 * `npm_config_user_agent` is set by every npm-compatible client and starts with
 * "<name>/<version>" — pnpm's begins "pnpm/". A missing value means this was
 * not run by a package manager at all, which is not pnpm either.
 */
export function isPnpmUserAgent(userAgent) {
  return typeof userAgent === 'string' && userAgent.startsWith('pnpm/');
}

/**
 * Deletes lockfiles belonging to other package managers.
 *
 * `force: true` is the `rm -f` this replaces: a lockfile that is not there is
 * the normal case, not a failure. Returns what was actually removed so the
 * caller can say so rather than reporting work it may not have done.
 */
export function removeConflictingLockfiles(repoRoot = REPO_ROOT, fsLike = fs) {
  const removed = [];
  for (const name of CONFLICTING_LOCKFILES) {
    const file = path.join(repoRoot, name);
    if (!fsLike.existsSync(file)) continue;
    fsLike.rmSync(file, { force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * The guard itself.
 *
 * Order matches the shell version it replaces: lockfiles are cleared first,
 * then the package manager is checked. That ordering is deliberate — a stray
 * package-lock.json should be cleaned up even on the run that then refuses.
 *
 * Returns an exit code instead of calling process.exit so the decision stays
 * testable.
 */
export function runPreinstall({ userAgent, repoRoot = REPO_ROOT, fsLike = fs, log = console } = {}) {
  removeConflictingLockfiles(repoRoot, fsLike);

  if (!isPnpmUserAgent(userAgent)) {
    log.error(
      `Use pnpm instead. This workspace is pnpm-only (packageManager is pinned in package.json); ` +
        `install with "corepack enable && pnpm install".${userAgent ? `\nDetected package manager: ${userAgent}` : ''}`,
    );
    return 1;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = runPreinstall({ userAgent: process.env.npm_config_user_agent });
}
