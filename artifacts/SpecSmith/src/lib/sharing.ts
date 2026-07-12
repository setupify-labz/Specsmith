// Shared build pages (/build?b=...) are intentionally kept out of search
// indexes (see SharedBuild.tsx and public/robots.txt) since each share
// creates a unique, unbounded URL. They remain fully shareable/linkable —
// this only affects crawling and indexing, not accessibility.

export interface ShareView {
  resolution: string;
  preset: string;
}

export function encodeBuild(build: Record<string, string | null>, name?: string, view?: ShareView): string {
  const payload = {
    ...build,
    _name: name ?? 'Shared Build',
    ...(view ? { _res: view.resolution, _preset: view.preset } : {}),
  };
  return btoa(JSON.stringify(payload));
}

export function decodeBuild(encoded: string): { build: Record<string, string | null>; name: string; view: ShareView | null } | null {
  try {
    const parsed = JSON.parse(atob(encoded));
    const { _name, _res, _preset, ...build } = parsed;
    return {
      build,
      name: _name ?? 'Shared Build',
      // Older share links predate _res/_preset; callers fall back to 1080p/high.
      view: _res && _preset ? { resolution: _res, preset: _preset } : null,
    };
  } catch {
    return null;
  }
}

export function getShareUrl(build: Record<string, string | null>, name?: string, view?: ShareView): string {
  const encoded = encodeBuild(build, name, view);
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
  return `${base}/build?b=${encodeURIComponent(encoded)}`;
}
