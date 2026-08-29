'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { markOnboardingSeen } from '@/lib/onboarding';
import { sfx } from '@/lib/sfx';
import styles from './welcome.module.css';

/**
 * The intro, shown once before the first sign-in.
 *
 * Four cards, in the order the game actually happens: you send, they hunt, you
 * bank boxes, and one wrong tap takes them all away. That last card is the
 * whole reason this screen exists — the penalty is severe and completely
 * invisible until it fires, and losing a full board to a rule nobody mentioned
 * reads as the game being broken rather than hard.
 *
 * Illustrations are built from the same moulded tiles as the board, so the
 * pieces are already familiar by the time a real match starts.
 */

interface Slide {
  key: string;
  title: string;
  body: string;
  art: React.ReactNode;
}

function Tile({ children, face, className }: { children: React.ReactNode; face?: string; className?: string }) {
  return (
    <span
      className={`tile-face ${styles.artTile} ${className ?? ''}`}
      style={face ? ({ ['--tile-face' as string]: face } as React.CSSProperties) : undefined}
    >
      {children}
    </span>
  );
}

const SLIDES: Slide[] = [
  {
    key: 'send',
    title: 'Send them a tile',
    body: 'Pick any tile on your board. It lands on your opponent’s screen instantly — no turns to wait for, no refresh.',
    art: (
      <div className={styles.art}>
        <div className={styles.artRow}>
          <Tile>4</Tile>
          <Tile face="var(--select)" className={styles.artPicked}>
            7
          </Tile>
          <Tile>2</Tile>
        </div>
        <span className={styles.artArrow} aria-hidden="true" />
        <div className={styles.artTarget}>
          <span className={styles.artTargetLabel}>They see</span>
          <span className={styles.artTargetValue}>7</span>
        </div>
      </div>
    )
  },
  {
    key: 'hunt',
    title: 'They hunt it. You bank boxes.',
    body: 'While they search their board for your tile, every box you tap is yours. The clock is their confusion.',
    art: (
      <div className={styles.art}>
        <div className={styles.artBoxes} aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => (
            <i key={i} data-filled={i < 17} />
          ))}
        </div>
        <span className={styles.artCaption}>17 banked and counting</span>
      </div>
    )
  },
  {
    key: 'penalty',
    title: 'A wrong tap costs you ten',
    body: 'Guess wrong and the last ten boxes you banked are taken back. The tile is crossed off so you never burn the same one twice — but those ten do not come back.',
    art: (
      <div className={styles.art}>
        <div className={styles.artRow}>
          <Tile>3</Tile>
          <Tile className={styles.artCross}>9</Tile>
          <Tile>5</Tile>
        </div>
        <span className={styles.artCaption} data-tone="bad">
          9 ruled out · 10 boxes gone
        </span>
      </div>
    )
  },
  {
    key: 'win',
    title: 'Find theirs to lock them out',
    body: 'The moment you find their tile, their boxes stop dead and the roles swap. First to fill every box wins.',
    art: (
      <div className={styles.art}>
        <div className={styles.artRow}>
          <Tile face="var(--good)">8</Tile>
        </div>
        <span className={styles.artCaption} data-tone="good">
          Found — they are locked
        </span>
      </div>
    )
  }
];

export default function WelcomePage() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const leave = useCallback(
    (to: string) => {
      markOnboardingSeen();
      router.replace(to);
    },
    [router]
  );

  const next = useCallback(() => {
    sfx.tap();
    if (last) leave('/register');
    else setIndex((i) => i + 1);
  }, [last, leave]);

  // Arrow keys, because someone reading this on a laptop will reach for them.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next]);

  const slide = SLIDES[index]!;

  return (
    <main className={styles.screen}>
      <div className={styles.top}>
        <span className={styles.wordmark}>Number Rush</span>
        <button type="button" className={styles.skip} onClick={() => leave('/login')}>
          Skip
        </button>
      </div>

      {/*
        Keyed on the slide so React remounts it — the entrance animation has to
        replay on every step, and a re-render alone would not restart it.
      */}
      <section className={styles.card} key={slide.key}>
        {slide.art}
        <h1 className={styles.title}>{slide.title}</h1>
        <p className={styles.body}>{slide.body}</p>
      </section>

      <div className={styles.bottom}>
        <div className={styles.dots} role="tablist" aria-label="Intro progress">
          {SLIDES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className={styles.dot}
              data-on={i === index}
              data-done={i < index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>

        <Button variant="primary" onClick={next}>
          {last ? 'Create an account' : 'Next'}
        </Button>

        <button type="button" className={styles.signIn} onClick={() => leave('/login')}>
          I already have an account
        </button>
      </div>
    </main>
  );
}
