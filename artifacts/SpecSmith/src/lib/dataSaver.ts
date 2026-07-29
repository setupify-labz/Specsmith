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
