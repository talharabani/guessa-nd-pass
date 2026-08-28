'use client';

import { useEffect, useState } from 'react';
import { applyTheme, loadTheme, THEMES, type ThemeId } from '@/lib/theme';
import { sfx } from '@/lib/sfx';
import styles from './theme.module.css';

/**
 * Skin picker.
 *
 * The chosen skin is already on <html> before React runs (see THEME_BOOT_SCRIPT),
 * so this component's only job is to show which one that is and change it. It
 * reads the stored value in an effect rather than during render because
 * localStorage does not exist on the server, and rendering a guess would make
 * the first paint disagree with the markup.
 *
 * `grid` gives every skin a card and a description — for the settings page.
 * `rail` is a row of swatches for putting the control within reach of someone
 * who is one tap from starting a match.
 */
export function ThemePicker({ variant = 'grid' }: { variant?: 'grid' | 'rail' }) {
  const [active, setActive] = useState<ThemeId | null>(null);

  useEffect(() => setActive(loadTheme()), []);

  function choose(id: ThemeId) {
    if (id === active) return;
    sfx.tap();
    applyTheme(id);
    setActive(id);
  }

  return (
    <div
      className={variant === 'rail' ? styles.rail : styles.grid}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {THEMES.map((theme) => {
        const selected = theme.id === active;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={variant === 'rail' ? styles.railItem : styles.card}
            data-selected={selected}
            onClick={() => choose(theme.id)}
            title={variant === 'rail' ? `${theme.name} — ${theme.blurb}` : undefined}
          >
            <span className={styles.swatch} aria-hidden="true">
              {theme.swatch.map((colour, i) => (
                <i key={colour} style={{ background: colour, animationDelay: `${i * 45}ms` }} />
              ))}
            </span>

            {variant === 'grid' ? (
              <span className={styles.meta}>
                <span className={styles.name}>{theme.name}</span>
                <span className={styles.blurb}>{theme.blurb}</span>
              </span>
            ) : (
              <span className={styles.railName}>{theme.name}</span>
            )}

            {/*
             * A ring alone would be the only cue for anyone who cannot separate
             * the selected border from the unselected one, so the current skin
             * is also marked with a glyph.
             */}
            <span className={styles.check} aria-hidden="true">
              {selected ? '✓' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
