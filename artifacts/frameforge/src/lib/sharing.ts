// Shared build pages (/build?b=...) are intentionally kept out of search
// indexes (see SharedBuild.tsx and public/robots.txt) since each share
// creates a unique, unbounded URL. They remain fully shareable/linkable —
// this only affects crawling and indexing, not accessibility.

export function encodeBuild(build: Record<string, string | null>, name?: string): string {
  const payload = { ...build, _name: name ?? 'Shared Build' };
  return btoa(JSON.stringify(payload));
}

export function decodeBuild(encoded: string): { build: Record<string, string | null>; name: string } | null {
  try {
    const parsed = JSON.parse(atob(encoded));
    const { _name, ...build } = parsed;
    return { build, name: _name ?? 'Shared Build' };
  } catch {
    return null;
  }
}

export function getShareUrl(build: Record<string, string | null>, name?: string): string {
  const encoded = encodeBuild(build, name);
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
  return `${base}/build?b=${encodeURIComponent(encoded)}`;
}
