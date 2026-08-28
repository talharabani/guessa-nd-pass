'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useGame } from '@/components/GameProvider';
import { Button, Loading, Panel, Toast } from '@/components/ui';
import { contentInfo } from '@/lib/content';
import { sfx } from '@/lib/sfx';
import styles from '../../pages.module.css';

/**
 * Real-time lobby. When the second player arrives, the host sees them appear
 * with no refresh; when the host starts, both clients move to the game together.
 */
export default function LobbyPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();

  const { user, loading } = useAuth();
  const { view, connected, joinGame, setReady, startGame, leaveGame, notice, dismissNotice } = useGame();
  const [copied, setCopied] = useState(false);
  const joinAttempted = useRef(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Land here from a refresh or a shared link: make sure we're actually seated.
  useEffect(() => {
    if (!connected || joinAttempted.current) return;
    if (view?.roomCode === code) return;
    joinAttempted.current = true;
    void joinGame(code).then((ack) => {
      if (!ack.ok) router.replace('/');
    });
  }, [connected, view?.roomCode, code, joinGame, router]);

  // The game started — both clients follow the server, nobody clicks anything.
  useEffect(() => {
    if (!view || view.roomCode !== code) return;
    if (view.status !== 'WAITING_FOR_PLAYER' && view.status !== 'READY') {
      router.replace(`/game/${code}`);
    }
  }, [view, code, router]);

  if (loading || !user) return <Loading label="Signing you in" />;
  if (!view || view.roomCode !== code) {
    return <Loading label={connected ? 'Joining the room' : 'Connecting to the server'} />;
  }

  const me = view.me;
  const foe = view.opponent;
  const seats = [
    { seat: 1, player: me?.seat === 1 ? me : foe?.seat === 1 ? foe : null },
    { seat: 2, player: me?.seat === 2 ? me : foe?.seat === 2 ? foe : null }
  ];
  const bothReady = !!me?.ready && !!foe?.ready;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  }

  return (
    <main className="center-screen">
      <div className={styles.home}>
        <div className={styles.brand}>
          <h1 className={styles.logo} style={{ fontSize: 30 }}>
            Lobby
          </h1>
          <p className={styles.tagline}>Share this code with your opponent.</p>
        </div>

        <Panel>
          <div className={styles.codeBlock}>
            <div className={styles.code}>{code}</div>
            <Button size="sm" variant="ghost" onClick={copyCode} style={{ marginTop: 10 }}>
              {copied ? 'Copied ✓' : 'Copy code'}
            </Button>
          </div>

          {/* The host chose these; the joining player should see what they are
              walking into before the countdown starts. */}
          <div className={styles.chips}>
            <span className={`${styles.chip} ${styles.chipStrong}`}>
              {contentInfo(view.contentType).sample.join(' ')} &nbsp;{contentInfo(view.contentType).name}
            </span>
            <span className={styles.chip}>{view.boardSize} tiles</span>
            <span className={styles.chip}>{view.totalBoxes} boxes to win</span>
          </div>

          <div className={styles.seats}>
            {seats.map(({ seat, player }) => (
              <div key={seat} className={`${styles.seat} ${player ? '' : styles.seatEmpty}`}>
                <span
                  className={`${styles.dot} ${
                    player?.connected === false
                      ? styles.dotOffline
                      : player?.ready
                        ? styles.dotReady
                        : ''
                  }`}
                />
                <span className={styles.seatName}>
                  {player ? `${player.username}${player.userId === me?.userId ? ' (you)' : ''}` : 'Waiting for a player…'}
                </span>
                <span className={`${styles.status} ${player?.ready ? styles.statusReady : ''}`}>
                  {!player ? 'Empty' : player.connected === false ? 'Offline' : player.ready ? 'Ready' : 'Not ready'}
                </span>
              </div>
            ))}
          </div>

          <div className="stack">
            <Button
              onClick={() => {
                sfx.tap();
                void setReady(!me?.ready);
              }}
              variant={me?.ready ? 'ghost' : 'default'}
            >
              {me?.ready ? 'Cancel ready' : "I'm ready"}
            </Button>

            {view.isHost ? (
              <Button
                variant="primary"
                disabled={!bothReady}
                onClick={() => {
                  sfx.tap();
                  void startGame();
                }}
              >
                {bothReady ? 'Start game' : 'Waiting for both players…'}
              </Button>
            ) : (
              <p className="tiny" style={{ textAlign: 'center' }}>
                {bothReady ? 'Waiting for the host to start the match…' : 'Ready up to begin'}
              </p>
            )}

            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                void leaveGame();
                router.replace('/');
              }}
            >
              Leave
            </Button>
          </div>
        </Panel>
      </div>

      <Toast message={notice} onDone={dismissNotice} />
    </main>
  );
}
