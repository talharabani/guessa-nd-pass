/**
 * Skins.
 *
 * A theme is nothing but a string written to `<html data-theme>`; the palette
 * itself lives in app/themes.css. Keep `THEME_IDS` in step with that file — the
 * picker renders from this list, and an id with no matching CSS block silently
 * falls back to the :root palette.
 *
 * Stored per device, never sent to the server: two players in the same match
 * can be on different skins and neither can tell.
 */

export type ThemeId = 'midnight' | 'nebula' | 'aurora' | 'ember' | 'synthwave' | 'daylight';

export interface Theme {
  id: ThemeId;
  name: string;
  blurb: string;
  /** Preview chips for the picker, in --accent / --select / --hunt / --box order. */
  swatch: [string, string, string, string];
  /** Drives the browser chrome colour so the phone status bar matches. */
  chrome: string;
  light?: boolean;
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Navy and cyan. The original.',
    swatch: ['#6c8cff', '#a78bfa', '#22d3ee', '#fbbf24'],
    chrome: '#0b0f1a'
  },
  {
    id: 'nebula',
    name: 'Nebula',
    blurb: 'Deep violet, magenta highlights.',
    swatch: ['#b47cff', '#ff6ec7', '#38bdf8', '#fcd34d'],
    chrome: '#0c0718'
  },
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Arctic teal and lime.',
    swatch: ['#2dd4bf', '#c084fc', '#7dd3fc', '#fb923c'],
    chrome: '#04120f'
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm charcoal and turquoise.',
    swatch: ['#ff8a3d', '#ff5fa2', '#ffd93d', '#4ecdc4'],
    chrome: '#140a09'
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    blurb: 'Neon on indigo. Loud.',
    swatch: ['#00e5ff', '#ff2e88', '#b967ff', '#fee440'],
    chrome: '#0f0620'
  },
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Light mode, for bright rooms.',
    swatch: ['#4f6ef7', '#7c3aed', '#0e8fa8', '#c2740a'],
    chrome: '#eef1f9',
    light: true
  }
];

export const DEFAULT_THEME: ThemeId = 'midnight';
export const THEME_KEY = 'number-rush.theme';

const IDS = new Set<string>(THEMES.map((t) => t.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && IDS.has(value);
}

export function themeOf(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function loadTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return isThemeId(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Paint the theme, then persist it.
 *
 * `data-theme-shift` switches the surface colours to a transition for the
 * length of the change only. Leaving it on permanently would put a transition
 * on every element in the game, which is the last thing a board that repaints
 * on every tap needs.
 */
export function applyTheme(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.dataset.theme = id;
  root.dataset.themeShift = '';
  window.setTimeout(() => delete root.dataset.themeShift, 400);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeOf(id).chrome);

  try {
    window.localStorage.setItem(THEME_KEY, id);
  } catch {
    /* private mode — the skin just won't survive a reload */
  }
}

/**
 * Runs before first paint, inlined into <head>.
 *
 * Without this the page renders one frame of the default skin before React
 * hydrates and corrects it, which is a visible flash — worst of all on
 * Daylight, where the whole screen goes from black to white.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY
)});var ok=${JSON.stringify(
  THEMES.map((t) => t.id)
)};document.documentElement.dataset.theme=ok.indexOf(t)>-1?t:${JSON.stringify(
  DEFAULT_THEME
)};}catch(e){}})()`;
