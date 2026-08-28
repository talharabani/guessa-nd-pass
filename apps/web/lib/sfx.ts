/**
 * Tiny WebAudio synth — no asset downloads, no latency. Sound is a gameplay
 * signal here: you must feel the lock land without reading the screen.
 */

type Ctx = AudioContext | null;

let ctx: Ctx = null;
let enabled = true;

const PREF_KEY = 'number-rush.sound';

if (typeof window !== 'undefined') {
  try {
    enabled = window.localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    /* default on */
  }
}

function audio(): Ctx {
  if (!enabled || typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function slide(from: number, to: number, dur: number, type: OscillatorType, vol: number): void {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Short vibration where supported — the spec asks for haptics on a wrong tap. */
function buzz(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

export const sfx = {
  get enabled(): boolean {
    return enabled;
  },
  toggle(): boolean {
    enabled = !enabled;
    try {
      window.localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (enabled) audio();
    return enabled;
  },
  tap: () => tone(320, 0.05, 'square', 0.05),
  select: () => {
    tone(520, 0.08, 'triangle', 0.07);
    tone(780, 0.1, 'triangle', 0.06, 0.07);
  },
  fill: () => {
    slide(540, 920, 0.1, 'square', 0.06);
    buzz(10);
  },
  correct: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.13, 'square', 0.07, i * 0.06));
    buzz([15, 30, 15]);
  },
  wrong: () => {
    slide(210, 70, 0.2, 'sawtooth', 0.06);
    buzz(90);
  },
  /** A wrong guess that actually cost boxes: heavier, longer, unmistakable. */
  wipe: () => {
    slide(320, 60, 0.42, 'sawtooth', 0.08);
    tone(140, 0.3, 'square', 0.05, 0.06);
    buzz([60, 45, 120]);
  },
  lock: () => {
    slide(190, 55, 0.28, 'square', 0.08);
    buzz(40);
  },
  countdown: () => tone(660, 0.09, 'triangle', 0.06),
  go: () => {
    tone(880, 0.16, 'triangle', 0.08);
    tone(1320, 0.2, 'triangle', 0.06, 0.08);
  },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'square', 0.08, i * 0.09)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.24, 'sawtooth', 0.06, i * 0.11))
};
