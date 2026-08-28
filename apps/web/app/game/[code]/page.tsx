'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useGame } from '@/components/GameProvider';
import { BoxBoard } from '@/components/game/BoxBoard';
import { NumberBoard } from '@/components/game/NumberBoard';
import { CountdownOverlay, OfflineStrip, TurnBanner, WinnerModal } from '@/components/game/Overlays';
import { PlayerHud } from '@/components/game/PlayerHud';
import { TargetPanel } from '@/components/game/TargetPanel';
import { Loading, Toast } from '@/components/ui';
import { sfx } from '@/lib/sfx';
import gameStyles from '@/components/game/game.module.css';
import styles from '../../pages.module.css';

/**
 * The game screen.
 *
 * Composition only — every piece renders from the server snapshot, and every
 * transition arrives over the socket. There is no "next turn" control anywhere.
 */
export default function GamePage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();

  const { user, loading } = useAuth();
  const { view, connected, joinGame, leaveGame, notice, dismissNotice, pulse } = useGame();
  const [sound, setSound] = useState(true);
  const [shake, setShake] = useState(false);
  const joinAttempted = useRef(false);

  useEffect(() => setSound(sfx.enabled), []);

  // Your own wrong guess flinches the whole screen — it just cost you every box.
  useEffect(() => {
    if (pulse?.kind !== 'wrong') return;
    setShake(true);
    const t = setTimeout(() => setShake(false), 440);
    return () => clearTimeout(t);
  }, [pulse]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Refreshed mid-match: rejoin the room and let the server restore everything.
  useEffect(() => {
    if (!connected || joinAttempted.current) return;
    if (view?.roomCode === code) return;
    joinAttempted.current = true;
    void joinGame(code).then((ack) => {
      if (!ack.ok) router.replace('/');
    });
  }, [connected, view?.roomCode, code, joinGame, router]);

  // Fell back to the lobby (rematch reset, opponent left before start).
  useEffect(() => {
    if (!view || view.roomCode !== code) return;
    if (view.status === 'WAITING_FOR_PLAYER' || view.status === 'READY') {
      router.replace(`/lobby/${code}`);
    }
  }, [view, code, router]);

  if (loading || !user) return <Loading label="Signing you in" />;
  if (!view || view.roomCode !== code) {
    return <Loading label={connected ? 'Restoring your match' : 'Reconnecting to the game'} />;
  }

  return (
    <main className={`shell ${shake ? gameStyles.shake : ''}`} style={{ paddingBottom: 32 }}>
      <div className={styles.gameTop}>
        <span className={styles.roomTag}>ROOM {view.roomCode}</span>
        <div className="row">
          {!connected ? <span className="tiny" style={{ color: 'var(--bad)' }}>Reconnecting…</span> : null}
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={sound ? 'Mute sound' : 'Unmute sound'}
            onClick={() => setSound(sfx.toggle())}
          >
            {sound ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Leave game"
            onClick={() => {
              void leaveGame();
              router.replace('/');
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <OfflineStrip view={view} />
      <PlayerHud view={view} />

      <div className={gameStyles.stage}>
        <div className={gameStyles.sideColumn}>
          <TargetPanel view={view} />
          <BoxBoard view={view} />
        </div>
        <NumberBoard view={view} />
      </div>

      <TurnBanner view={view} />
      <CountdownOverlay />
      <WinnerModal view={view} onHome={() => {
        void leaveGame();
        router.replace('/');
      }} />
      <Toast message={notice} onDone={dismissNotice} />
    </main>
  );
}
