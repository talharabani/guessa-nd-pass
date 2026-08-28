'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GameSettings } from '@/components/GameSettings';
import { Button, Loading, Panel } from '@/components/ui';
import { loadPreferences, savePreferences, DEFAULT_PREFERENCES, type Preferences } from '@/lib/settings';
import { sfx } from '@/lib/sfx';
import settingsStyles from '@/components/settings.module.css';
import styles from '../pages.module.css';

/**
 * Defaults for the games you create, plus the device-level toggles.
 * Saved to this browser only — the server never reads any of it.
 */
export default function SettingsPage() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [sound, setSound] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrefs(loadPreferences());
    setSound(sfx.enabled);
  }, []);

  function update(next: Preferences) {
    setPrefs(next);
    savePreferences(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  if (!prefs) return <Loading label="Loading settings" />;

  return (
    <main className="shell" style={{ maxWidth: 620, paddingBottom: 40 }}>
      <div className={styles.brand} style={{ marginTop: 24 }}>
        <h1 className={styles.logo} style={{ fontSize: 34 }}>
          Settings
        </h1>
        <p className={styles.tagline}>Defaults for the games you create.</p>
      </div>

      <Panel title={saved ? 'Match setup · saved ✓' : 'Match setup'}>
        <GameSettings value={prefs} onChange={update} />
        <p className={styles.settingsNote}>
          Both players share one board content type, so whoever creates the room chooses it. Joining
          a game uses that host&apos;s setup, not yours.
        </p>
      </Panel>

      <Panel title="This device">
        <div className={settingsStyles.toggleRow} style={{ borderTop: 'none' }}>
          <span>
            <span className={settingsStyles.toggleLabel}>Sound effects</span>
            <span className={settingsStyles.toggleHint} style={{ display: 'block' }}>
              Taps, the lock thud, and the win fanfare
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={sound}
            aria-label="Sound effects"
            className={`${settingsStyles.switch} ${sound ? settingsStyles.switchOn : ''}`}
            onClick={() => setSound(sfx.toggle())}
          >
            <span className={settingsStyles.knob} />
          </button>
        </div>
      </Panel>

      <div className="stack">
        <Button
          variant="ghost"
          onClick={() => {
            update(DEFAULT_PREFERENCES);
            sfx.tap();
          }}
        >
          Reset to defaults
        </Button>
        <Link href="/">
          <Button variant="primary">Done</Button>
        </Link>
      </div>
    </main>
  );
}
