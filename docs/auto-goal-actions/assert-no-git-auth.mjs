#!/usr/bin/env node
// Refuses to continue if Git in this checkout could authenticate to a remote. Run by the implement
// job immediately before the Claude CLI starts (same step, same environment) and again before the
// patch is exported. It reports only the names of what it found, never a value.
//
//   node docs/auto-goal-actions/assert-no-git-auth.mjs <checkout>
//
// It checks the ways a GitHub credential reaches Git or the gh CLI: token variables in the
// environment, Git config that injects an Authorization header or credential helper (what
// actions/checkout leaves behind without persist-credentials: false), credentials embedded in a
// remote or rewrite URL, askpass and SSH overrides, Git config injected through the environment, and
// credential files in the home directory. It is a check of known paths, not proof that no other
// route exists.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_VARS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"];
const ASKPASS_VARS = ["GIT_ASKPASS", "SSH_ASKPASS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"];
const RISKY_KEY = /^(http\..*\.extraheader|http\.extraheader|credential(\..*)?\.helper|credential\..*|core\.askpass|core\.sshcommand|include\.path|includeif\..*\.path)$/i;
const USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@]+@/i;

/** Every Git authentication route found, as names only. Empty means none of the known routes is present. */
export function findGitAuth(cwd, env = process.env) {
  const found = [];
  for (const name of [...TOKEN_VARS, ...ASKPASS_VARS]) if (env[name]) found.push(`environment variable ${name}`);
  for (const name of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) found.push(`environment variable ${name}`);
  let config = "";
  try {
    config = execFileSync("git", ["config", "--list", "--show-origin", "--null"], { cwd, env, encoding: "utf8" });
  } catch {
    found.push("git config could not be read");
  }
  for (const entry of config.split("\0").filter(Boolean)) {
    // --show-origin --null prints "origin\0key\nvalue\0" pairs; keep the key and value of each.
    const [key, ...rest] = entry.split("\n");
    if (!rest.length) continue;
    const value = rest.join("\n");
    if (RISKY_KEY.test(key)) found.push(`git config ${key.toLowerCase()}`);
    if (/^(remote\..*\.(url|pushurl)|url\..*\.(insteadof|pushinsteadof))$/i.test(key) && USERINFO.test(value)) found.push(`git config ${key.toLowerCase()} carries credentials`);
    if (/^url\..*\.(insteadof|pushinsteadof)$/i.test(key) && USERINFO.test(key.replace(/^url\./i, "").replace(/\.(push)?insteadof$/i, ""))) found.push(`git config ${key.toLowerCase()} rewrites to a URL with credentials`);
  }
  const home = env.HOME || homedir();
  const xdg = env.XDG_CONFIG_HOME || join(home, ".config");
  for (const file of [join(home, ".git-credentials"), join(xdg, "git", "credentials"), join(xdg, "gh", "hosts.yml"), join(home, ".netrc")]) {
    if (existsSync(file)) found.push(`credential file ${file}`);
  }
  return [...new Set(found)];
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const cwd = process.argv[2] ?? ".";
  const found = findGitAuth(cwd);
  if (found.length) {
    console.error(`Refusing: Git could authenticate from this step:\n- ${found.join("\n- ")}`);
    process.exit(1);
  }
  console.log("No known Git authentication route is configured for this step.");
}
