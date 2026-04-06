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
