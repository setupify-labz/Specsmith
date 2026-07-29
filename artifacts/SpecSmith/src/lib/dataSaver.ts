// NetworkInformation.saveData isn't in TS's lib.dom types yet.
interface NavigatorWithConnection extends Navigator {
  connection?: { saveData?: boolean };
}

/** True when the browser reports the OS/browser "Data Saver" setting is on
 * (Chrome/Android; Safari and Firefox don't expose this, so it's always
 * false there — the caller just proceeds as normal). */
export function isDataSaverOn(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as NavigatorWithConnection).connection?.saveData === true;
}

const OVERRIDE_KEY = 'specsmith-3d-data-saver-override';

/** Once someone explicitly says "show it anyway" on one page (Builder or
 * Crate), remember that for the rest of the visit — otherwise navigating
 * between the two would re-block the panel every time despite them already
 * having opted in. */
export function hasDataSaverOverride(): boolean {
  try { return localStorage.getItem(OVERRIDE_KEY) === '1'; } catch { return false; }
}

export function setDataSaverOverride(): void {
  try { localStorage.setItem(OVERRIDE_KEY, '1'); } catch { /* ignore */ }
}
