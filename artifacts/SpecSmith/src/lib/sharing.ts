// Shared build pages (/build?b=...) are intentionally kept out of search
// indexes (see SharedBuild.tsx and public/robots.txt) since each share
// creates a unique, unbounded URL. They remain fully shareable/linkable —
// this only affects crawling and indexing, not accessibility.

export interface ShareView {
  resolution: string;
  preset: string;
}

export interface SharedCustomPart {
  name: string;
  price: number;
}

export function encodeBuild(
  build: Record<string, string | null>,
  name?: string,
  view?: ShareView,
  customParts?: SharedCustomPart[],
): string {
  const payload = {
    ...build,
    _name: name ?? 'Shared Build',
    ...(view ? { _res: view.resolution, _preset: view.preset } : {}),
    ...(customParts && customParts.length > 0 ? { _custom: customParts.map(c => ({ n: c.name, p: c.price })) } : {}),
  };
  return btoa(JSON.stringify(payload));
}

export function decodeBuild(encoded: string): {
  build: Record<string, string | null>;
  name: string;
  view: ShareView | null;
  customParts: SharedCustomPart[];
} | null {
  try {
    const parsed = JSON.parse(atob(encoded));
    const { _name, _res, _preset, _custom, ...build } = parsed;
    return {
      build,
      name: _name ?? 'Shared Build',
      // Older share links predate _res/_preset; callers fall back to 1080p/high.
      view: _res && _preset ? { resolution: _res, preset: _preset } : null,
      customParts: Array.isArray(_custom)
        ? _custom
            .filter((c: unknown): c is { n: string; p: number } =>
              !!c && typeof (c as { n?: unknown }).n === 'string' && typeof (c as { p?: unknown }).p === 'number')
            .map(c => ({ name: c.n, price: c.p }))
        : [],
    };
  } catch {
    return null;
  }
}

export function getShareUrl(
  build: Record<string, string | null>,
  name?: string,
  view?: ShareView,
  customParts?: SharedCustomPart[],
): string {
  const encoded = encodeBuild(build, name, view, customParts);
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
  return `${base}/build?b=${encodeURIComponent(encoded)}`;
}

// File-based export/import — a plain, human-readable JSON file rather than
// the base64 blob URLs use (no need for URL-safety here), so someone can
// open it and see what's in it. This is a local backup/transfer mechanism,
// independent of the account system: it works with no login and no
// backend, which also makes it the one way to move a build to another
// device or browser today, since saved builds live only in this browser's
// localStorage.
const BUILD_FILE_VERSION = 1;

interface BuildFilePayload {
  specsmithBuildFile: number;
  name: string;
  build: Record<string, string | null>;
  view?: ShareView;
  customParts?: SharedCustomPart[];
  exportedAt: string;
}

export function buildToFileContent(
  build: Record<string, string | null>,
  name?: string,
  view?: ShareView,
  customParts?: SharedCustomPart[],
): string {
  const payload: BuildFilePayload = {
    specsmithBuildFile: BUILD_FILE_VERSION,
    name: name ?? 'My SpecSmith Build',
    build,
    ...(view ? { view } : {}),
    ...(customParts && customParts.length > 0 ? { customParts } : {}),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBuildFileContent(text: string): {
  build: Record<string, string | null>;
  name: string;
  view: ShareView | null;
  customParts: SharedCustomPart[];
} | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.build !== 'object' || parsed.build === null) return null;
    const view = parsed.view && typeof parsed.view.resolution === 'string' && typeof parsed.view.preset === 'string'
      ? { resolution: parsed.view.resolution, preset: parsed.view.preset }
      : null;
    const customParts = Array.isArray(parsed.customParts)
      ? parsed.customParts.filter((c: unknown): c is SharedCustomPart =>
          !!c && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { price?: unknown }).price === 'number')
      : [];
    return {
      build: parsed.build,
      name: typeof parsed.name === 'string' ? parsed.name : 'Imported Build',
      view,
      customParts,
    };
  } catch {
    return null;
  }
}

function slugifyFileName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'specsmith-build';
}

export function downloadBuildFile(
  build: Record<string, string | null>,
  name?: string,
  view?: ShareView,
  customParts?: SharedCustomPart[],
): void {
  const content = buildToFileContent(build, name, view, customParts);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugifyFileName(name ?? 'specsmith-build')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
