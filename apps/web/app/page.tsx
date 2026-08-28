'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccountBar } from '@/components/AccountBar';
import { useAuth } from '@/components/AuthProvider';
import { useGame } from '@/components/GameProvider';
import { GameSettings } from '@/components/GameSettings';
import { Button, Field, Loading, Panel, Toast } from '@/components/ui';
import { contentInfo } from '@/lib/content';
import { loadPreferences, savePreferences, type Preferences } from '@/lib/settings';
import { sfx } from '@/lib/sfx';
import styles from './pages.module.css';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { connected, createGame, joinGame, notice, dismissNotice } = useGame();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  // Preferences live in localStorage, so they can only be read on the client.
  useEffect(() => setPrefs(loadPreferences()), []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user || !prefs) {
    return <Loading label="Getting you ready" />;
  }

  async function onCreate() {
    if (!prefs) return;
    setError(null);
    setBusy('create');
    sfx.tap();
    savePreferences(prefs); // remember this setup for next time
    const ack = await createGame(prefs);
    setBusy(null);
    if (ack.ok && ack.roomCode) router.push(`/lobby/${ack.roomCode}`);
    else setError(ack.error ?? 'Could not create a game.');
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError('Enter the 5-character game code.');
      return;
    }
    setError(null);
    setBusy('join');
    sfx.tap();
    const ack = await joinGame(trimmed);
    setBusy(null);
    if (ack.ok) router.push(`/lobby/${ack.roomCode ?? trimmed}`);
    else setError(ack.error ?? 'Could not join that game.');
  }

  const mode = contentInfo(prefs.contentType);

  return (
    <main className="center-screen">
      <div className={styles.home}>
        <AccountBar />

        <div className={styles.brand}>
          <h1 className={styles.logo}>Number Rush</h1>
          <p className={styles.tagline}>
            Send a tile. They hunt it. You fill boxes until they find it.
          </p>
        </div>

        <Panel>
          <div className="stack">
            {error ? <p className={styles.error}>{error}</p> : null}

            {/* What the boards are made of, chosen before the room exists —
                both players share one set, so it is the host's call. */}
            <button
              type="button"
              className={styles.setupToggle}
              onClick={() => {
                sfx.tap();
                setShowSetup((v) => !v);
              }}
              aria-expanded={showSetup}
            >
              <span>
                <span className={styles.setupLabel}>Game setup</span>
                <span className={styles.setupSummary}>
                  {mode.name} · {prefs.boardSize} tiles · {prefs.boxCount} boxes
                </span>
              </span>
              <span className={styles.setupChevron} data-open={showSetup}>
                ▾
              </span>
            </button>

            {showSetup ? (
              <div className={styles.setupBody}>
                <GameSettings value={prefs} onChange={setPrefs} />
              </div>
            ) : null}

            <Button variant="primary" onClick={onCreate} disabled={!connected || busy !== null}>
              {busy === 'create' ? 'Creating your room…' : 'Create game'}
            </Button>

            <form onSubmit={onJoin} className={styles.joinRow}>
              <Field
                label="Join with a code"
                code
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC12"
                maxLength={8}
                autoCapitalize="characters"
                spellCheck={false}
              />
              <Button type="submit" disabled={!connected || busy !== null} style={{ minHeight: 52 }}>
                {busy === 'join' ? '…' : 'Join'}
              </Button>
            </form>

            <div className={styles.homeLinks}>
              <Link href="/how-to-play">
                <Button variant="ghost">How to play</Button>
              </Link>
              <Link href="/settings">
                <Button variant="ghost">Settings</Button>
              </Link>
            </div>
          </div>
        </Panel>
      </div>

      <Toast message={notice ?? error} onDone={dismissNotice} />
    </main>
  );
}
