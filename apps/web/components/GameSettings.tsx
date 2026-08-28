'use client';

import { CONTENT_OPTIONS } from '@/lib/content';
import { LIMITS, type Preferences } from '@/lib/settings';
import { sfx } from '@/lib/sfx';
import type { ContentType } from '@/lib/types';
import styles from './settings.module.css';

/**
 * The match setup. Shared by the create-game form and the settings page, so the
 * two can never drift apart.
 *
 * Board size is capped by the chosen token set — there are only 26 letters, so a
 * 36-tile letter board is impossible. The control reflects that immediately
 * rather than letting you pick something the server would silently clamp.
 */
export function GameSettings({
  value,
  onChange,
  compact
}: {
  value: Preferences;
  onChange: (next: Preferences) => void;
  compact?: boolean;
}) {
  const active = CONTENT_OPTIONS.find((o) => o.value === value.contentType) ?? CONTENT_OPTIONS[0]!;
  const maxTiles = Math.min(LIMITS.boardSize.max, active.maxTiles);
  const boardSize = Math.min(value.boardSize, maxTiles);

  const pick = (contentType: ContentType) => {
    sfx.tap();
    const nextMax = Math.min(
      LIMITS.boardSize.max,
      CONTENT_OPTIONS.find((o) => o.value === contentType)?.maxTiles ?? LIMITS.boardSize.max
    );
    onChange({ ...value, contentType, boardSize: Math.min(value.boardSize, nextMax) });
  };

  return (
    <div className={styles.wrap}>
      <div>
        <div className={styles.legend}>Board content</div>
        <div className={styles.choices}>
          {CONTENT_OPTIONS.map((option) => {
            const selected = option.value === value.contentType;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => pick(option.value)}
                aria-pressed={selected}
                className={`${styles.choice} ${selected ? styles.choiceOn : ''}`}
              >
                <span className={styles.sample} aria-hidden="true">
                  {option.sample.map((s) => (
                    <span key={s} className={styles.sampleTile}>
                      {s}
                    </span>
                  ))}
                </span>
                <span className={styles.choiceName}>{option.name}</span>
                <span className={styles.choiceHint}>{option.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {compact ? null : (
        <>
          <Slider
            label="Boxes to fill"
            hint="How long the race runs"
            value={value.boxCount}
            min={LIMITS.boxCount.min}
            max={LIMITS.boxCount.max}
            step={LIMITS.boxCount.step}
            onChange={(boxCount) => onChange({ ...value, boxCount })}
          />
          <Slider
            label="Tiles per board"
            hint={`Up to ${maxTiles} with ${active.name.toLowerCase()}`}
            value={boardSize}
            min={LIMITS.boardSize.min}
            max={maxTiles}
            step={LIMITS.boardSize.step}
            onChange={(size) => onChange({ ...value, boardSize: size })}
          />
        </>
      )}
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className={styles.slider}>
      <span className={styles.sliderTop}>
        <span className={styles.legend}>{label}</span>
        <span className={styles.sliderValue}>{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.range}
      />
      <span className={styles.sliderHint}>{hint}</span>
    </label>
  );
}
