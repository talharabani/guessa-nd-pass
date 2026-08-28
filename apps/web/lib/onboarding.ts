/**
 * First-run intro.
 *
 * The rule this game runs on — a wrong tap wipes every box you have banked —
 * is not something a player should discover by losing to it. The intro exists
 * to say that once, before the first match.
 *
 * Per browser, like the theme. Nothing here reaches the server.
 */

export const ONBOARDING_KEY = 'number-rush.onboarded';

export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return true; // never redirect during SSR
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    // Private mode: showing the intro twice is a far smaller problem than
    // trapping someone on it, so treat an unreadable store as "already seen".
    return true;
  }
}

export function markOnboardingSeen(): void {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* private mode — they will see it again next visit */
  }
}

export function resetOnboarding(): void {
  try {
    window.localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    /* nothing to clear */
  }
}
