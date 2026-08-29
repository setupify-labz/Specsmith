// Mints a Rakuten access token for one CI job.
//
//   npx tsx scripts/retail/rakuten/request-access-token.ts --out "$RUNNER_TEMP/token"
//
// Prints `::add-mask::<token>` to stdout so GitHub registers the value as a
// secret BEFORE anything else can emit it, then writes the token to the file
// named by --out with owner-only permissions. Nothing else is printed.
//
// A token carrying a control character is refused before either happens — see
// assertTokenIsSafeToMask, which keeps a hostile response from forging a second
// workflow command out of the mask line.
//
// WHY A FILE AND NOT STDOUT
// -------------------------
// The mask has to reach the runner to work, and the runner only sees output
// the step does not capture. `TOKEN=$(script)` would swallow the mask line
// along with the token, registering nothing. So the two go different ways: the
// mask to stdout where GitHub reads it, the token to a file the calling step
// reads and deletes.
//
// WHY NOT $GITHUB_ENV
// -------------------
// That would export the token to every later step in the job, including the
// one that renders a report into a job summary. The token is needed by exactly
// one command; a file the caller removes keeps it that way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AccessTokenError, requestAccessToken } from './accessTokenRequest';

const here = path.dirname(fileURLToPath(import.meta.url));
/** artifacts/SpecSmith/scripts/retail/rakuten -> repository root. */
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..');

export class TokenOutputPathError extends Error {}

/**
 * Resolves --out, refusing anywhere inside the repository.
 *
 * A credential written into the checkout could be committed by a later step or
 * picked up by a build. The runner's temp directory is outside the working
 * tree and is discarded with the job, so that is the only sensible home for
 * one — and "outside the repository" is the property worth enforcing, since it
 * holds wherever the runner puts its temp.
 */
export function resolveTokenOutputPath(out: string, root: string = repoRoot): string {
  if (typeof out !== 'string' || out.trim() === '') {
    throw new TokenOutputPathError('--out is required and must not be blank.');
  }
  if (!path.isAbsolute(out)) {
    throw new TokenOutputPathError('--out must be an absolute path.');
  }
  const resolved = path.resolve(out);
  const resolvedRoot = path.resolve(root);
  if (resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new TokenOutputPathError('--out is inside the repository; a credential must never be written into the checkout.');
  }
  return resolved;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** The one line this command prints on success. Exported so a test can pin it. */
export const maskCommand = (token: string): string => `::add-mask::${token}`;

/** C0 controls, DEL, and the C1 range. Anything unprintable. */
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Rejects a token that could not safely be written into a workflow command.
 *
 * `::add-mask::<token>` is a LINE-ORIENTED protocol: the runner reads stdout a
 * line at a time and executes any line beginning `::`. A token containing a
 * newline would therefore end the mask early and let whatever follows be
 * executed as a second command of the attacker's choosing — `::add-path::`,
 * `::set-output::`, an `echo` of something else. A carriage return can hide the
 * remainder of a line in the rendered log, and a NUL truncates it for anything
 * reading C strings.
 *
 * The far end is not trusted to be well behaved just because it answered 200,
 * so this is checked here rather than assumed. A real Rakuten token is opaque
 * printable text; nothing legitimate is lost by refusing the rest. The failure
 * says only that a control character was present — never which one, never
 * where, and never any part of the value.
 */
export class UnsafeTokenError extends Error {}

export function assertTokenIsSafeToMask(token: string): void {
  if (CONTROL_CHARACTER.test(token)) {
    throw new UnsafeTokenError(
      'The token endpoint returned a value containing a control character. It was not masked, not written and not used.',
    );
  }
}

async function run(argv: string[], io: { log: (l: string) => void; fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv }): Promise<void> {
  const outPath = resolveTokenOutputPath(flag(argv, 'out') ?? '');
  const token = await requestAccessToken({ fetch: io.fetch, env: io.env });

  // BEFORE the mask, because the mask itself is the thing a hostile token would
  // subvert: nothing is printed until the value is known to be one line.
  assertTokenIsSafeToMask(token);

  // Mask FIRST. Until this line is read by the runner, the value is not
  // redacted anywhere, so nothing may touch it before the mask is registered.
  io.log(maskCommand(token));

  // 0o600: readable by the job's own user and nobody else on the runner.
  fs.writeFileSync(outPath, token, { mode: 0o600 });
}

/**
 * Reduces any failure to one sanitized line naming a closed category.
 *
 * Never the credentials, never the response body, never a stack — a stack
 * quotes surrounding code and paths, and this runs where a log is public to
 * anyone with repository access.
 */
export function sanitizedFailureLine(cause: unknown): string {
  if (cause instanceof AccessTokenError) {
    const status = cause.httpStatus === null ? '' : ` (HTTP ${cause.httpStatus})`;
    return `Access token request failed [${cause.category}]${status}: ${cause.message}`;
  }
  if (cause instanceof TokenOutputPathError) return `Access token output path rejected: ${cause.message}`;
  // Names the condition, never the value: the whole point of refusing this
  // token is that it is not safe to put on a line.
  if (cause instanceof UnsafeTokenError) return `Access token request failed [unsafe-token]: ${cause.message}`;
  return 'Access token request failed [unexpected].';
}

export async function main(
  argv: string[],
  io: { log?: (l: string) => void; error?: (l: string) => void; fetch?: typeof globalThis.fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const log = io.log ?? ((l: string) => console.log(l));
  const error = io.error ?? ((l: string) => console.error(l));
  try {
    await run(argv, { log, fetch: io.fetch, env: io.env });
    return 0;
  } catch (cause) {
    error(sanitizedFailureLine(cause));
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
