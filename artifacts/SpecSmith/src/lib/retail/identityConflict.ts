/** Contradiction detection only. A URL slug can reject a match, never verify one. */
export type IdentityConflict = 'gpu-model-conflict' | 'gpu-variant-conflict';

function gpuModels(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return new Set(Array.from(normalized.matchAll(/\b(rtx|gtx|rx)\s*(\d{3,4})(?:\s*(ti|xtx|xt))?(?:\s*(super))?\b/g),
    (match) => match.slice(1).filter(Boolean).join('')));
}

function gigabyteFamilies(text: string): Set<string> {
  // Use the explicit manufacturer model code, not generic prose such as
  // "WINDFORCE cooling" in a GAMING product's marketing description.
  return new Set(Array.from(text.toLowerCase().matchAll(/\bgv[- ]n\d+(gaming|wf\d*|eagle|aero)/g),
    (match) => match[1].startsWith('wf') ? 'windforce' : match[1]));
}

function disjoint(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && b.size > 0 && ![...a].some((value) => b.has(value));
}

export function detectIdentityConflict(name: string, trackedUrl: string): IdentityConflict | null {
  let pathname: string;
  try {
    const tracking = new URL(trackedUrl);
    const destination = tracking.searchParams.get('murl');
    if (!destination) return null; // unknown identity; not evidence of an exact match
    const url = new URL(destination);
    if (url.protocol !== 'https:' || !['newegg.com', 'www.newegg.com'].includes(url.hostname)) return null;
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (disjoint(gpuModels(name), gpuModels(pathname))) return 'gpu-model-conflict';
  if (disjoint(gigabyteFamilies(name), gigabyteFamilies(pathname))) return 'gpu-variant-conflict';
  return null;
}
