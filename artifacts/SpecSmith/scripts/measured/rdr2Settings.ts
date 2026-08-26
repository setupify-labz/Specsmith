// Read-only parser for Red Dead Redemption 2's PC settings file, system.xml.
//
// READ ONLY. This module contains no write-capable filesystem call anywhere
// in it — no writeFileSync, no unlinkSync, no renameSync — and the injectable
// `fsLike` it accepts is typed with only `existsSync` and `readFileSync`.
// There is nothing in this file that could touch the operator's game
// settings even by accident.
//
// WHAT system.xml ACTUALLY IS
// ----------------------------
// Verified against a real, complete system.xml sample published by a
// long-running community parser project (github.com/Forceflow/
// rdr2_settings_parser — see this file's test suite, which pins that exact
// content as a fixture), plus a second independent source confirming
// `kSettingAPI_DX12` as a real value. It is a flat-ish XML document, root
// `<rage__fwuiSystemSettingsCollection>`, with exactly two element shapes:
//
//   <tagName value="N" />        numeric or boolean settings
//   <tagName>textValue</tagName>  enum-like string settings
//
// RDR2 HAS NO SINGLE "PRESET"
// ----------------------------
// Unlike games with a single graphics-quality dropdown, RDR2 exposes each
// category (texture, shadow, reflection, ...) as an independently-set value,
// plus an unlabeled `graphicsQualityPreset` float whose exact semantics are
// not verified here. Mapping this onto SpecSmith's own MeasuredPreset union
// is deliberately NOT attempted by this module — that would invent a
// cross-game equivalence exactly like the one ../../src/lib/measured/types.ts
// already warns against for `unmapped`. This module only reads and validates
// what the file actually says; deciding how (or whether) that becomes part of
// a MeasuredObservation is separate, later work.
//
// WHY A HAND-ROLLED EXTRACTOR, NOT AN XML LIBRARY
// -------------------------------------------------
// The known field set is small, flat, and each tag name appears at most once
// in a well-formed file. A per-tag anchored regex is enough to read it
// correctly and to detect the one structural failure that matters here (a
// critical tag appearing more than once — see "conflicting" below), without
// a new dependency for a document this simple. This mirrors presentmon.ts,
// which hand-parses CSV rather than pulling in a library for the same reason.
//
// FAIL-CLOSED, NOT BEST-EFFORT
// ------------------------------
// A required tag that is absent is rejected as missing. A critical tag that
// appears more than once is rejected as CONFLICTING — this parser has no way
// to know which of two values the game actually used, and picking either
// would be a guess wearing the shape of a fact. A value outside its exact
// known set (an enum string never seen in a real file, a windowed/vSync code
// this parser was not built against) is rejected as unknown rather than
// coerced to the nearest known value. None of this is designed to be
// permissive — a newer RDR2 patch that adds a setting value is expected to
// make this parser refuse the file until it is deliberately extended against
// a real sample of that value, not silently guess at what the new value means.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** No system.xml exists at any candidate location. */
export class Rdr2SettingsNotFoundError extends Error {}

/** More than one candidate location has a system.xml; which one is real is ambiguous. */
export class Rdr2SettingsAmbiguousLocationError extends Error {}

/** The file exists but its content is missing, malformed, conflicting, or carries an unrecognized value. */
export class Rdr2SettingsFormatError extends Error {}

// ---------------------------------------------------------------------------
// Locating system.xml
// ---------------------------------------------------------------------------

export type SettingsLocationSource = 'documents' | 'onedrive' | 'explicit';

export interface SettingsLocation {
  path: string;
  source: SettingsLocationSource;
}

const SETTINGS_RELATIVE_PARTS = ['Rockstar Games', 'Red Dead Redemption 2', 'Settings', 'system.xml'];

export interface LocateDeps {
  homedir?: () => string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Every place system.xml might legitimately be, in priority order — not a
 * decision about which one is real. That decision is locateRdr2SettingsFile's
 * job, made against the actual filesystem.
 *
 * The OneDrive candidates come from environment variables Windows' own
 * OneDrive installer sets for exactly this purpose (`OneDriveConsumer` for a
 * personal account, `OneDriveCommercial` for a work/school account, `OneDrive`
 * as whichever is currently active) — reading them is using an authoritative
 * signal the OS already provides, not guessing a folder name like
 * "OneDrive - Some Company" from a pattern.
 *
 * Built with `path.win32.join`, not the platform-dependent `path.join`. This
 * collector only ever runs these paths for real on Windows (readRdr2SystemSettings
 * refuses off it), but the pure candidate list here is exercised by tests on
 * whatever OS runs the suite — `path.join` resolves to POSIX-join semantics
 * there, and would join `home` and `Documents` with `/`, mismatching what
 * Windows itself would produce. Same reasoning as windows-smoke-test.ps1's
 * own tsx-loader path resolution.
 */
export function candidateRdr2SettingsPaths(deps: LocateDeps = {}): SettingsLocation[] {
  const homedir = deps.homedir ?? os.homedir;
  const env = deps.env ?? process.env;
  const home = homedir();

  const candidates: SettingsLocation[] = [
    { path: path.win32.join(home, 'Documents', ...SETTINGS_RELATIVE_PARTS), source: 'documents' },
  ];
  for (const key of ['OneDriveConsumer', 'OneDriveCommercial', 'OneDrive']) {
    const base = env[key];
    if (base && base.trim() !== '') {
      candidates.push({ path: path.win32.join(base, 'Documents', ...SETTINGS_RELATIVE_PARTS), source: 'onedrive' });
    }
  }

  // OneDrive env vars regularly point at the same folder (OneDrive and
  // OneDriveConsumer are often identical on a personal-only install) —
  // de-duplicated by resolved path so that is not reported as an ambiguity.
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.path)) return false;
    seen.add(c.path);
    return true;
  });
}

export interface LocateFsLike {
  existsSync(p: string): boolean;
}

/**
 * Picks the one real system.xml, or refuses.
 *
 * More than one candidate existing on disk at once — a real Documents copy
 * and a stale OneDrive one, say — is refused rather than guessed at by
 * priority order, the same principle presentmonRunner.ts's selectTargetProcess
 * applies to two processes sharing a name: this parser cannot know which file
 * the game most recently wrote, and picking either would attribute a run's
 * settings to a file that might not be the one that produced them.
 */
export function locateRdr2SettingsFile(deps: LocateDeps & { fsLike?: LocateFsLike } = {}): SettingsLocation {
  const fsLike = deps.fsLike ?? fs;
  const candidates = candidateRdr2SettingsPaths(deps);
  const found = candidates.filter((c) => fsLike.existsSync(c.path));

  if (found.length === 0) {
    throw new Rdr2SettingsNotFoundError(
      `No RDR2 system.xml found. Checked: ${candidates.map((c) => c.path).join('; ')}. ` +
        'If RDR2 has never been run with graphics settings saved (only on a successful exit), this file will not exist yet.',
    );
  }
  if (found.length > 1) {
    throw new Rdr2SettingsAmbiguousLocationError(
      `Found a system.xml at more than one location: ${found.map((c) => c.path).join('; ')}. ` +
        'Refusing to guess which one the game actually reads — pass an explicit path instead.',
    );
  }
  return found[0];
}

// ---------------------------------------------------------------------------
// Known value sets — extend ONLY against a real observed sample, never a guess
// ---------------------------------------------------------------------------

const ROOT_ELEMENT = 'rage__fwuiSystemSettingsCollection';

/** Every kSettingLevel_* value actually observed in a real system.xml or a corroborating source. */
export const RDR2_QUALITY_LEVELS = [
  'kSettingLevel_Low',
  'kSettingLevel_Medium',
  'kSettingLevel_High',
  'kSettingLevel_Ultra',
  'kSettingLevel_Custom',
] as const;
export type Rdr2QualityLevel = (typeof RDR2_QUALITY_LEVELS)[number];

/**
 * Only two values, deliberately. `kSettingAPI_Vulkan` came from the pinned
 * real fixture; `kSettingAPI_DX12` from a second, independent source quoting
 * a real file's <API> tag verbatim. RDR2 is widely known to also offer a
 * DX11 mode, but no source seen while building this parser gave its exact
 * literal string — so it is not in this list. A real file reporting it will
 * be refused as an unrecognized API rather than have this parser assume the
 * obvious-looking `kSettingAPI_DX11`.
 */
export const RDR2_GRAPHICS_APIS = ['kSettingAPI_Vulkan', 'kSettingAPI_DX12'] as const;
export type Rdr2GraphicsApi = (typeof RDR2_GRAPHICS_APIS)[number];

/** The only `windowed value="N"` codes observed; this parser does not assert what each number means, only that it is one of these. */
export const RDR2_WINDOWED_CODES = [0, 1, 2] as const;
/** The only `vSync value="N"` codes observed; likewise not decoded into an Off/On/Adaptive label this parser cannot verify. */
export const RDR2_VSYNC_CODES = [0, 1, 2] as const;

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

type TagShape = 'value-attr' | 'text';

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every occurrence of `tag` in `raw`, in the given shape. More than one
 * result means the tag is CONFLICTING (see requireOneTag); zero means it is
 * missing. Anchored so that, e.g., a search for "screenWidth" cannot match
 * "screenWidthWindowed" — the character immediately following the tag name
 * must be the shape's own delimiter (whitespace before `value=`, or `>`),
 * never an arbitrary letter.
 */
function extractTag(raw: string, tag: string, shape: TagShape): string[] {
  const t = escapeForRegExp(tag);
  const re =
    shape === 'value-attr'
      ? new RegExp(`<${t}\\s+value="([^"]*)"\\s*/>`, 'g')
      : new RegExp(`<${t}>([^<]*)</${t}>`, 'g');
  return [...raw.matchAll(re)].map((m) => m[1]);
}

function requireOneTag(raw: string, tag: string, shape: TagShape): string {
  const values = extractTag(raw, tag, shape);
  if (values.length === 0) {
    throw new Rdr2SettingsFormatError(
      `Missing required <${tag}> setting. This may not be an RDR2 system.xml, or is a version/format this parser was not built against.`,
    );
  }
  if (values.length > 1) {
    throw new Rdr2SettingsFormatError(
      `<${tag}> appears ${values.length} times, with values [${values.map((v) => JSON.stringify(v)).join(', ')}]. ` +
        'Refusing to guess which one the game actually used.',
    );
  }
  return values[0];
}

function requirePositiveInt(raw: string, tag: string): number {
  const v = requireOneTag(raw, tag, 'value-attr');
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Rdr2SettingsFormatError(`<${tag} value="${v}" /> is not a positive whole number.`);
  }
  return n;
}

function requireIntInSet(raw: string, tag: string, allowed: readonly number[]): number {
  const v = requireOneTag(raw, tag, 'value-attr');
  const n = Number(v);
  if (!Number.isInteger(n) || !allowed.includes(n)) {
    throw new Rdr2SettingsFormatError(
      `<${tag} value="${v}" /> is not one of the values this parser recognizes (${allowed.join(', ')}). Not guessing at an unrecognized value.`,
    );
  }
  return n;
}

function requireNonEmptyText(raw: string, tag: string): string {
  const v = requireOneTag(raw, tag, 'text').trim();
  if (v === '') {
    throw new Rdr2SettingsFormatError(`<${tag}> is present but empty.`);
  }
  return v;
}

function requireFromSet<T extends string>(raw: string, tag: string, allowed: readonly T[]): T {
  const v = requireOneTag(raw, tag, 'text');
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Rdr2SettingsFormatError(
      `<${tag}>${v}</${tag}> is not one of the values this parser recognizes (${allowed.join(', ')}). ` +
        'Not guessing at an unrecognized value — this may be a newer game version this parser has not been updated for.',
    );
  }
  return v as T;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface Rdr2DisplaySettings {
  screenWidth: number;
  screenHeight: number;
  /** Raw `windowed value="N"` code — see RDR2_WINDOWED_CODES; not decoded into a label. */
  windowed: number;
  /** Raw `vSync value="N"` code — see RDR2_VSYNC_CODES; not decoded into a label. */
  vSync: number;
}

export interface Rdr2GraphicsSettings {
  textureQuality: Rdr2QualityLevel;
  shadowQuality: Rdr2QualityLevel;
  reflectionQuality: Rdr2QualityLevel;
  taa: Rdr2QualityLevel;
  api: Rdr2GraphicsApi;
}

export interface Rdr2ParsedSettings {
  /** RDR2's own settings-schema version — the file's top-level <version value="N" />. */
  schemaVersion: number;
  /** Verbatim, untranslated GPU name string the game itself recorded. Informational only. */
  videoCardDescription: string;
  display: Rdr2DisplaySettings;
  graphics: Rdr2GraphicsSettings;
}

/**
 * Parses and validates the known field set from system.xml's raw text.
 *
 * Pure: takes text, returns data or throws. No filesystem access, so this is
 * exercised directly by tests without touching disk — same separation as
 * parsePresentMonCsv in presentmon.ts.
 */
export function parseRdr2SystemSettingsXml(raw: string): Rdr2ParsedSettings {
  if (raw.trim() === '') {
    throw new Rdr2SettingsFormatError('system.xml is empty.');
  }
  if (!raw.includes(`<${ROOT_ELEMENT}>`) && !raw.includes(`<${ROOT_ELEMENT} `)) {
    throw new Rdr2SettingsFormatError(
      `This file's root element is not <${ROOT_ELEMENT}>. It may not be an RDR2 system.xml, or belongs to a different game or version this parser was not built against.`,
    );
  }

  return {
    schemaVersion: requirePositiveInt(raw, 'version'),
    videoCardDescription: requireNonEmptyText(raw, 'videoCardDescription'),
    display: {
      screenWidth: requirePositiveInt(raw, 'screenWidth'),
      screenHeight: requirePositiveInt(raw, 'screenHeight'),
      windowed: requireIntInSet(raw, 'windowed', RDR2_WINDOWED_CODES),
      vSync: requireIntInSet(raw, 'vSync', RDR2_VSYNC_CODES),
    },
    graphics: {
      textureQuality: requireFromSet(raw, 'textureQuality', RDR2_QUALITY_LEVELS),
      shadowQuality: requireFromSet(raw, 'shadowQuality', RDR2_QUALITY_LEVELS),
      reflectionQuality: requireFromSet(raw, 'reflectionQuality', RDR2_QUALITY_LEVELS),
      taa: requireFromSet(raw, 'taa', RDR2_QUALITY_LEVELS),
      api: requireFromSet(raw, 'API', RDR2_GRAPHICS_APIS),
    },
  };
}

// ---------------------------------------------------------------------------
// Reading from disk
// ---------------------------------------------------------------------------

export interface Rdr2SystemSettings extends Rdr2ParsedSettings {
  location: SettingsLocation;
  /** The exact bytes read, decoded as UTF-8, completely unmodified. */
  raw: string;
  /** SHA-256 over the raw bytes as read from disk. */
  sha256: string;
}

/**
 * The only filesystem capability this module is given. No write method
 * exists on this type, so nothing in this file could call one even by
 * accident — the type checker itself enforces "read only."
 */
export interface ReadFsLike extends LocateFsLike {
  readFileSync(p: string): Buffer;
}

export interface ReadDeps extends LocateDeps {
  fsLike?: ReadFsLike;
  /** Bypasses locateRdr2SettingsFile entirely — for an operator pointing at a specific copy. Still read-only. */
  explicitPath?: string;
  platform?: NodeJS.Platform;
}

/**
 * Locates, reads, hashes and validates system.xml in one call.
 *
 * Windows-only, matching every other real-machine probe in this collector
 * (presentmonRunner.ts, environment.ts): RDR2 has no native Mac client, and a
 * Proton/Linux install keeps its Documents-equivalent under a WINEPREFIX this
 * function does not know how to find, so there is no honest fallback path.
 */
export function readRdr2SystemSettings(deps: ReadDeps = {}): Rdr2SystemSettings {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error(
      `RDR2 settings parsing is Windows-only (detected platform: ${platform}). system.xml only exists under a real Windows Documents folder.`,
    );
  }

  const fsLike = deps.fsLike ?? fs;
  const location: SettingsLocation = deps.explicitPath
    ? { path: deps.explicitPath, source: 'explicit' }
    : locateRdr2SettingsFile(deps);

  if (!fsLike.existsSync(location.path)) {
    throw new Rdr2SettingsNotFoundError(`No file at ${location.path}.`);
  }

  const bytes = fsLike.readFileSync(location.path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const raw = bytes.toString('utf-8');
  const parsed = parseRdr2SystemSettingsXml(raw);

  return { ...parsed, location, raw, sha256 };
}
