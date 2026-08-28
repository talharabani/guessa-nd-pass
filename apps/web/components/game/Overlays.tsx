'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { useGame, type Pulse } from '@/components/GameProvider';
import { sfx } from '@/lib/sfx';
import type { GameView } from '@/lib/types';
import styles from './game.module.css';

/* ─────────────────────── turn banner (role changes) ─────────────────────── */

interface BannerState {
  id: number;
  text: string;
  sub?: string;
  tone: 'good' | 'bad' | 'hunt' | 'neutral';
}

function bannerFor(pulse: Pulse, view: GameView | null): BannerState | null {
  const id = pulse.id;
  switch (pulse.kind) {
    case 'start':
      return { id, text: view?.canSelect ? 'You select first' : 'Opponent selects', tone: 'neutral' };
    case 'selected':
      return view?.role === 'seeker'
        ? { id, text: 'New target', sub: String(pulse.value ?? ''), tone: 'hunt' }
        : { id, text: 'Fill your boxes!', tone: 'good' };
    case 'correct':
      return { id, text: '✓ Correct', sub: String(pulse.value ?? ''), tone: 'good' };
    case 'wrong':
      // The penalty is the headline: say exactly what it cost.
      return pulse.boxesLost
        ? { id, text: '✕ Wrong', sub: `−${pulse.boxesLost} boxes`, tone: 'bad' }
        : { id, text: '✕ Wrong', sub: 'Keep looking', tone: 'bad' };
    case 'opponent_wrong':
      return pulse.boxesLost
        ? { id, text: 'They missed!', sub: `−${pulse.boxesLost} boxes`, tone: 'good' }
        : null;
    case 'locked':
      return { id, text: 'Locked', sub: `They found ${pulse.value}`, tone: 'bad' };
    case 'opponent_left':
      return { id, text: 'Opponent disconnected', tone: 'bad' };
    case 'opponent_back':
      return { id, text: 'Opponent reconnected ✓', tone: 'good' };
    default:
      return null;
  }
}

export function TurnBanner({ view }: { view: GameView | null }) {
  const { pulse } = useGame();
  const [banner, setBanner] = useState<BannerState | null>(null);

  useEffect(() => {
    if (!pulse) return;
    const next = bannerFor(pulse, view);
    if (!next) return;
    setBanner(next);
    // Short on purpose: this must never sit between a guess and the next tap.
    const t = setTimeout(() => setBanner(null), 1150);
    return () => clearTimeout(t);
    // `view` is intentionally excluded: the banner is decided at pulse time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);

  if (!banner) return null;
  return (
    <div className={styles.banner} key={banner.id}>
      <div className={styles.bannerInner} data-tone={banner.tone}>
        <span className={styles.bannerText}>{banner.text}</span>
        {banner.sub ? <span className={styles.bannerSub}>{banner.sub}</span> : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────── countdown ─────────────────────────────── */

export function CountdownOverlay() {
  const { countdown } = useGame();
  if (countdown === null) return null;
  return (
    <div className={styles.countdown}>
      <div>
        <div className={styles.countdownNum} key={countdown}>
          {countdown}
        </div>
        <div className={styles.countdownLabel}>Get ready</div>
      </div>
    </div>
  );
}

/* ──────────────────────────── winner + rematch ─────────────────────────── */

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        duration: 2.2 + Math.random() * 1.6,
        color: ['var(--box)', 'var(--accent)', 'var(--good)', 'var(--select)', 'var(--hunt)'][i % 5]
      })),
    []
  );
  return (
    <div className={styles.confetti} aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          className={styles.confettiBit}
          style={{
            left: `${b.left}%`,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`
          }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}

export function WinnerModal({ view, onHome }: { view: GameView; onHome: () => void }) {
  const { requestRematch } = useGame();
  const [asked, setAsked] = useState(false);
  const finished = view.status === 'FINISHED';
  const iWon = !!view.me && view.winnerUserId === view.me.userId;

  useEffect(() => {
    if (!finished) {
      setAsked(false);
      return;
    }
    if (iWon) sfx.win();
    else sfx.lose();
  }, [finished, iWon]);

  if (!finished) return null;

  const opponentWaiting = view.opponent?.wantsRematch;

  return (
    <>
      {iWon ? <Confetti /> : null}
      <Modal open>
        <div className={styles.trophy}>{iWon ? '🏆' : '💥'}</div>
        <h2 className={styles.winTitle} data-win={iWon}>
          {iWon ? 'You win!' : 'You lose'}
        </h2>
        <p className="muted">
          {iWon
            ? 'Every box filled. Clean race.'
            : `${view.opponent?.username ?? 'Your opponent'} filled every box first.`}
        </p>

        <div className={styles.finalScore}>
          <div>
            You
            <b>
              {view.me?.progress ?? 0}/{view.totalBoxes}
            </b>
          </div>
          <div>
            {view.opponent?.username ?? 'Opponent'}
            <b>
              {view.opponent?.progress ?? 0}/{view.totalBoxes}
            </b>
          </div>
        </div>

        <dl className={styles.stats}>
          <Stat label="Tiles found" value={view.me?.stats.totalFound ?? 0} />
          <Stat label="Wrong guesses" value={view.me?.stats.wrongGuesses ?? 0} />
          <Stat label="Best streak" value={view.me?.stats.bestStreak ?? 0} />
          <Stat label="Boxes lost" value={view.me?.stats.boxesLost ?? 0} />
        </dl>

        <div className="stack">
          <Button
            variant="primary"
            disabled={asked}
            onClick={() => {
              setAsked(true);
              sfx.tap();
              void requestRematch();
            }}
          >
            {asked ? 'Waiting for opponent…' : 'Play again'}
          </Button>
          {opponentWaiting && !asked ? (
            <p className="tiny" style={{ color: 'var(--good)' }}>
              {view.opponent?.username} wants a rematch
            </p>
          ) : null}
          <Button variant="ghost" onClick={onHome}>
            Back to home
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* ────────────────────────── opponent offline strip ─────────────────────── */

export function OfflineStrip({ view }: { view: GameView }) {
  if (!view.opponent || view.opponent.connected || view.status === 'FINISHED') return null;
  return (
    <div className={styles.offline} role="status">
      <span className={styles.offlineDots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <b>{view.opponent.username} disconnected.</b> Waiting for them to reconnect — your game is
        saved.
      </span>
    </div>
  );
}
