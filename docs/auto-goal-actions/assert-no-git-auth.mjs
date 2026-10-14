#!/usr/bin/env node
// Refuses to continue if Git in this checkout could authenticate to a remote. Run by the implement
// job immediately before the Claude CLI starts (same step, same environment) and again before the
// patch is exported. It prints only fixed category messages, never a name, key, URL, path or value.
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

const TOKEN_VARS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
const OIDC_VARS = ["ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"];
const ASKPASS_VARS = ["GIT_ASKPASS", "SSH_ASKPASS", "GIT_SSH", "GIT_SSH_COMMAND"];
const USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@]+@/i;

/**
 * Every message the guard can print. Findings are only ever drawn from this table, so nothing read
 * from the environment, Git config or the filesystem (a key, a URL, a path, a value) is printed.
 * A rewrite rule's key, for example, is itself a URL and may carry a credential.
 */
export const CATEGORY = Object.freeze({
  tokenVariable: "a GitHub token environment variable is set",
  oidcVariable: "a GitHub OIDC token request variable is set",
  askpassVariable: "a Git askpass or SSH override variable is set",
  envConfig: "Git config is injected through the environment",
  unreadableConfig: "Git config could not be read",
  extraHeader: "Git config sets an HTTP extra header",
  credentialConfig: "Git config sets a credential helper or credential option",
  askpassConfig: "Git config sets an askpass program or SSH command",
  includeConfig: "Git config includes another config file",
  remoteWithCredentials: "a remote URL carries credentials",
  rewriteWithCredentials: "a URL rewrite rule carries credentials",
  credentialFile: "a Git or gh credential file exists in the home directory",
});

/** Every Git authentication route found, as fixed category messages. Empty means none of the known routes is present. */
export function findGitAuth(cwd, env = process.env) {
  const found = new Set();
  if (TOKEN_VARS.some((n) => env[n])) found.add(CATEGORY.tokenVariable);
  if (OIDC_VARS.some((n) => env[n])) found.add(CATEGORY.oidcVariable);
  if (ASKPASS_VARS.some((n) => env[n])) found.add(CATEGORY.askpassVariable);
  if (env.GIT_CONFIG_PARAMETERS || env.GIT_CONFIG_COUNT || Object.keys(env).some((n) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(n))) found.add(CATEGORY.envConfig);
  let config = "";
  try {
    config = execFileSync("git", ["config", "--list", "--null"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    found.add(CATEGORY.unreadableConfig);
  }
  for (const entry of config.split("\0").filter(Boolean)) {
    // --null prints "key\nvalue" per entry. Keys are compared case-insensitively, never printed.
    const nl = entry.indexOf("\n");
    const key = (nl < 0 ? entry : entry.slice(0, nl)).toLowerCase();
    const value = nl < 0 ? "" : entry.slice(nl + 1);
    if (/^http\.(.*\.)?extraheader$/.test(key)) found.add(CATEGORY.extraHeader);
    if (/^credential\./.test(key)) found.add(CATEGORY.credentialConfig);
    if (/^core\.(askpass|sshcommand)$/.test(key)) found.add(CATEGORY.askpassConfig);
    if (/^(include\.path|includeif\..*\.path)$/.test(key)) found.add(CATEGORY.includeConfig);
    if (/^remote\..*\.(url|pushurl)$/.test(key) && USERINFO.test(value)) found.add(CATEGORY.remoteWithCredentials);
    if (/^url\..*\.(insteadof|pushinsteadof)$/.test(key)) {
      const target = entry.slice(4, nl < 0 ? undefined : nl).replace(/\.(push)?insteadof$/i, "");
      if (USERINFO.test(target) || USERINFO.test(value)) found.add(CATEGORY.rewriteWithCredentials);
    }
  }
  const home = env.HOME || homedir();
  const xdg = env.XDG_CONFIG_HOME || join(home, ".config");
  if ([join(home, ".git-credentials"), join(xdg, "git", "credentials"), join(xdg, "gh", "hosts.yml"), join(home, ".netrc")].some((f) => existsSync(f))) found.add(CATEGORY.credentialFile);
  return [...found];
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
