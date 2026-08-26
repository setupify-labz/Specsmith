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
// WHY A HAND-ROLLED PARSER, NOT AN XML LIBRARY
// -----------------------------------------------
// The known field set is small and flat. A first version of this module read
// it with a per-tag regex over the raw text, with no notion of document
// structure at all — which meant it could not tell a real tag from one
// sitting inside an XML comment, outside the root element, or in a document
// that was truncated or otherwise not well-formed XML to begin with. This
// version instead tokenizes the WHOLE document once (see parseXmlElements
// below) — comments, CDATA, tags and text are all classified in one pass,
// nesting is verified to balance, and there must be exactly one top-level
// element, named correctly. It is still not a general XML parser (no
// namespaces, no DTD, no entity decoding) — exactly as much real parsing as
// this one, small, well-known document shape needs, without a new dependency.
// This mirrors presentmon.ts, which hand-parses CSV rather than pulling in a
// library for the same reason.
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
// XML well-formedness validation and element extraction
// ---------------------------------------------------------------------------
//
// A per-tag regex over the raw text — this module's first version — happily
// "finds" a tag inside an XML comment, on the wrong side of the root
// element's closing tag, or with a truncated/unclosed document, because it
// never establishes that the document is well-formed XML at all. This
// tokenizer does that first: it walks the ENTIRE document once, classifying
// every construct (comment, CDATA, processing instruction, opening tag,
// closing tag, self-closing tag, text), and only records an element's value
// when it has actually seen a real, correctly-nested occurrence of it. A
// comment containing what looks like a real tag never produces a token at
// all — its content is consumed as one opaque unit — so it can never be
// mistaken for one.
//
// This is not a general XML parser: no namespaces, no DTD, no entity
// decoding beyond what JavaScript already does to the source string. It is
// exactly as much real parsing as this one, small, flat, well-known document
// shape needs — matching presentmon.ts's own hand-rolled CSV parsing, scoped
// to what the file actually contains rather than to XML in general.

type TagShape = 'value-attr' | 'text';

type ElementOccurrence =
  | { shape: 'value-attr'; value: string | undefined }
  | { shape: 'text'; value: string };

/** Every occurrence of every element name found inside the single validated root, keyed by tag name. */
type ElementTable = Map<string, ElementOccurrence[]>;

// One token at a time, in document order. Alternatives are mutually
// exclusive by their leading character(s), so order does not create
// ambiguity. The tag-opening alternative requires attributes to be a strict
// run of `name="value"` pairs — anything else in a `<...>` construct (an
// unquoted value, a stray character, an unterminated attribute) matches NONE
// of these alternatives, which is what turns it into a detected parse
// failure below rather than something silently skipped.
const XML_TOKEN_RE =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([A-Za-z_][\w.-]*)\s*>|<([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.-]*\s*=\s*"[^"]*")*)\s*(\/?)>|[^<]+/g;

const ATTR_RE = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;

/**
 * Validates that `raw` is well-formed XML with exactly one top-level
 * element, that it is `<${ROOT_ELEMENT}>`, and that every open element is
 * closed by a matching tag — then returns every element found, by name.
 *
 * Throws Rdr2SettingsFormatError, not a generic parse error, for every
 * failure mode: an unclosed/truncated document, a closing tag that does not
 * match what is actually open, content before/after the root element, or a
 * `<...>` construct that does not fit any recognized XML shape at all
 * (covers malformed attributes — a tag whose attribute syntax is broken
 * simply never matches the opening-tag alternative, which is detected as a
 * stall in the scan below).
 */
function parseXmlElements(raw: string): ElementTable {
  const table: ElementTable = new Map();
  const record = (name: string, occurrence: ElementOccurrence) => {
    const list = table.get(name);
    if (list) list.push(occurrence);
    else table.set(name, [occurrence]);
  };

  const stack: Array<{ name: string; text: string[] }> = [];
  let topLevelCount = 0;
  let rootClosed = false;

  let pos = 0;
  while (pos < raw.length) {
    XML_TOKEN_RE.lastIndex = pos;
    const m = XML_TOKEN_RE.exec(raw);
    if (!m || m.index !== pos) {
      throw new Rdr2SettingsFormatError(
        `Malformed XML at character ${pos}: ${JSON.stringify(raw.slice(pos, Math.min(raw.length, pos + 40)))}. ` +
          'This does not match any recognized XML construct — check for an unquoted or unterminated attribute, ' +
          'or a stray "<".',
      );
    }
    const token = m[0];
    const closingName = m[2];
    const openingName = m[3];

    if (token[1] === '?' || token.startsWith('<!DOCTYPE')) {
      // XML declaration / processing instruction / doctype — not part of the setting data.
    } else if (token.startsWith('<!--')) {
      // A comment's content is consumed here as one opaque unit and never
      // re-scanned — this is precisely what stops a commented-out fake tag
      // from ever being read as a real setting.
    } else if (token.startsWith('<![CDATA[')) {
      if (stack.length === 0) {
        throw new Rdr2SettingsFormatError('CDATA content found outside the root element.');
      }
      stack[stack.length - 1].text.push(m[1] ?? '');
    } else if (closingName !== undefined) {
      const frame = stack.pop();
      if (!frame || frame.name !== closingName) {
        throw new Rdr2SettingsFormatError(
          frame
            ? `Mismatched closing tag: found </${closingName}> but <${frame.name}> was still open.`
            : `Closing tag </${closingName}> has no matching open element.`,
        );
      }
      record(frame.name, { shape: 'text', value: frame.text.join('') });
      if (stack.length === 0) rootClosed = true;
    } else if (openingName !== undefined) {
      const selfClosing = m[5] === '/';

      if (stack.length === 0) {
        topLevelCount += 1;
        if (rootClosed) {
          throw new Rdr2SettingsFormatError(
            `Unexpected element <${openingName}> found after the root element </${ROOT_ELEMENT}> had already closed.`,
          );
        }
        if (topLevelCount > 1 || openingName !== ROOT_ELEMENT) {
          throw new Rdr2SettingsFormatError(
            `Unexpected top-level element <${openingName}> — this document's only top-level element must be <${ROOT_ELEMENT}>.`,
          );
        }
      }

      if (selfClosing) {
        let value: string | undefined;
        for (const am of (m[4] ?? '').matchAll(ATTR_RE)) {
          if (am[1] === 'value') value = am[2];
        }
        record(openingName, { shape: 'value-attr', value });
        if (stack.length === 0) rootClosed = true;
      } else {
        stack.push({ name: openingName, text: [] });
      }
    } else {
      // Plain text between tags. Non-whitespace text outside every element
      // (before the root opens or after it closes) means the document is not
      // what this parser expects, so it is rejected rather than ignored.
      if (stack.length > 0) stack[stack.length - 1].text.push(token);
      else if (token.trim() !== '') {
        throw new Rdr2SettingsFormatError(`Unexpected text outside the root element: ${JSON.stringify(token.trim().slice(0, 40))}.`);
      }
    }

    pos = XML_TOKEN_RE.lastIndex;
  }

  if (stack.length > 0) {
    throw new Rdr2SettingsFormatError(
      `Unclosed element(s) at end of file: <${stack.map((f) => f.name).join('>, <')}>. The document is truncated or missing a closing tag.`,
    );
  }
  if (!rootClosed || topLevelCount === 0) {
    throw new Rdr2SettingsFormatError(`No <${ROOT_ELEMENT}> root element found.`);
  }

  return table;
}

function requireOneTag(table: ElementTable, tag: string, shape: TagShape): string {
  const occurrences = table.get(tag) ?? [];
  const matching = occurrences.filter((o): o is Extract<ElementOccurrence, { shape: typeof shape }> => o.shape === shape);

  if (matching.length === 0) {
    if (occurrences.length > 0) {
      throw new Rdr2SettingsFormatError(
        `<${tag}> is present but not in the expected form ` +
          `(expected ${shape === 'value-attr' ? 'a self-closing tag with a "value" attribute' : 'text content'}).`,
      );
    }
    throw new Rdr2SettingsFormatError(
      `Missing required <${tag}> setting. This may not be an RDR2 system.xml, or is a version/format this parser was not built against.`,
    );
  }
  if (matching.length > 1) {
    throw new Rdr2SettingsFormatError(
      `<${tag}> appears ${matching.length} times, with values [${matching.map((o) => JSON.stringify(o.value)).join(', ')}]. ` +
        'Refusing to guess which one the game actually used.',
    );
  }

  const value = matching[0].value;
  if (value === undefined) {
    throw new Rdr2SettingsFormatError(`<${tag}> has no "value" attribute.`);
  }
  return value;
}

function requirePositiveInt(table: ElementTable, tag: string): number {
  const v = requireOneTag(table, tag, 'value-attr');
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Rdr2SettingsFormatError(`<${tag} value="${v}" /> is not a positive whole number.`);
  }
  return n;
}

function requireIntInSet(table: ElementTable, tag: string, allowed: readonly number[]): number {
  const v = requireOneTag(table, tag, 'value-attr');
  const n = Number(v);
  if (!Number.isInteger(n) || !allowed.includes(n)) {
    throw new Rdr2SettingsFormatError(
      `<${tag} value="${v}" /> is not one of the values this parser recognizes (${allowed.join(', ')}). Not guessing at an unrecognized value.`,
    );
  }
  return n;
}

function requireNonEmptyText(table: ElementTable, tag: string): string {
  const v = requireOneTag(table, tag, 'text').trim();
  if (v === '') {
    throw new Rdr2SettingsFormatError(`<${tag}> is present but empty.`);
  }
  return v;
}

function requireFromSet<T extends string>(table: ElementTable, tag: string, allowed: readonly T[]): T {
  const v = requireOneTag(table, tag, 'text');
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
  /**
   * RDR2 keeps a SEPARATE resolution pair for windowed mode, always present
   * alongside screenWidth/screenHeight regardless of which mode is active.
   * Preserved raw, like screenWidth/screenHeight — NOT used to decide which
   * pair is "the" active resolution. That decision depends on what each
   * `windowed` code actually means, which this parser does not assert (see
   * `windowed` below); doing so without that would be exactly the kind of
   * guess this module refuses to make.
   */
  screenWidthWindowed: number;
  screenHeightWindowed: number;
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
 *
 * Structure is validated FIRST, by parseXmlElements, and completely: a
 * truncated file, a mismatched closing tag, content outside the root, or a
 * malformed attribute all fail here before any field is read, rather than
 * letting an ad-hoc per-field check paper over a document that was never
 * well-formed XML to begin with.
 */
export function parseRdr2SystemSettingsXml(raw: string): Rdr2ParsedSettings {
  if (raw.trim() === '') {
    throw new Rdr2SettingsFormatError('system.xml is empty.');
  }

  const table = parseXmlElements(raw);

  return {
    schemaVersion: requirePositiveInt(table, 'version'),
    videoCardDescription: requireNonEmptyText(table, 'videoCardDescription'),
    display: {
      screenWidth: requirePositiveInt(table, 'screenWidth'),
      screenHeight: requirePositiveInt(table, 'screenHeight'),
      screenWidthWindowed: requirePositiveInt(table, 'screenWidthWindowed'),
      screenHeightWindowed: requirePositiveInt(table, 'screenHeightWindowed'),
      windowed: requireIntInSet(table, 'windowed', RDR2_WINDOWED_CODES),
      vSync: requireIntInSet(table, 'vSync', RDR2_VSYNC_CODES),
    },
    graphics: {
      textureQuality: requireFromSet(table, 'textureQuality', RDR2_QUALITY_LEVELS),
      shadowQuality: requireFromSet(table, 'shadowQuality', RDR2_QUALITY_LEVELS),
      reflectionQuality: requireFromSet(table, 'reflectionQuality', RDR2_QUALITY_LEVELS),
      taa: requireFromSet(table, 'taa', RDR2_QUALITY_LEVELS),
      api: requireFromSet(table, 'API', RDR2_GRAPHICS_APIS),
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
