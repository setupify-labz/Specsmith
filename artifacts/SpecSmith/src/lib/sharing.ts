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
