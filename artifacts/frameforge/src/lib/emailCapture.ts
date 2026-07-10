export interface EmailCapture {
  email: string;
  buildId: string;
  capturedAt: string;
}

function getCaptures(): EmailCapture[] {
  try { return JSON.parse(localStorage.getItem('frameforge-email-captures') || '[]'); } catch { return []; }
}

function setCaptures(captures: EmailCapture[]) {
  localStorage.setItem('frameforge-email-captures', JSON.stringify(captures));
}

export function saveEmailCapture(email: string, buildId: string): void {
  const captures = getCaptures();
  captures.push({ email, buildId, capturedAt: new Date().toISOString() });
  setCaptures(captures);
}

const DISMISSED_KEY = 'frameforge-email-capture-dismissed';

export function hasDismissedEmailCapture(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === '1';
}

export function dismissEmailCaptureForever(): void {
  localStorage.setItem(DISMISSED_KEY, '1');
}
