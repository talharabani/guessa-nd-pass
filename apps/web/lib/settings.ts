import type { ContentType } from './types';

/**
 * Per-device preferences. These are only DEFAULTS for the create-game form —
 * the match itself runs on whatever the host actually sent to the server, which
 * the server then clamps. Nothing here is trusted by the backend.
 */
export interface Preferences {
  contentType: ContentType;
  boxCount: number;
  boardSize: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  contentType: 'DIGITS',
  boxCount: 100,
  boardSize: 20
};

export const LIMITS = {
  boxCount: { min: 20, max: 200, step: 10 },
  boardSize: { min: 9, max: 36, step: 1 }
};

const KEY = 'number-rush.preferences';

export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      contentType: parsed.contentType ?? DEFAULT_PREFERENCES.contentType,
      boxCount: clamp(parsed.boxCount, LIMITS.boxCount, DEFAULT_PREFERENCES.boxCount),
      boardSize: clamp(parsed.boardSize, LIMITS.boardSize, DEFAULT_PREFERENCES.boardSize)
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — settings just won't persist */
  }
}

function clamp(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}
