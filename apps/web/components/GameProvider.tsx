'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { SERVER_URL } from '@/lib/api';
import { sfx } from '@/lib/sfx';
import type { ContentType, CorrectGuessEvent, GameView, NumberSelectedEvent, Token } from '@/lib/types';
import { useAuth } from './AuthProvider';

/**
 * Owns the single socket connection and the authoritative snapshot.
 *
 * Everything the UI shows comes from `view`. The client never advances the turn,
 * never computes progress and never decides whether an action is allowed — it
 * mirrors the server and animates the difference.
 */

type Ack = { ok: boolean; error?: string; roomCode?: string };

/** A one-shot signal for components to animate against. */
export interface GameSettings {
  boxCount?: number;
  boardSize?: number;
  contentType?: ContentType;
}

export interface Pulse {
  id: number;
  kind:
    | 'selected'
    | 'correct'
    | 'wrong'
    | 'opponent_wrong'
    | 'locked'
    | 'filled'
    | 'countdown'
    | 'start'
    | 'finished'
    | 'opponent_left'
    | 'opponent_back';
  value?: Token;
  seconds?: number;
  boxesLost?: number;
}

interface GameContextValue {
  connected: boolean;
  view: GameView | null;
  pulse: Pulse | null;
  countdown: number | null;
  notice: string | null;
  dismissNotice: () => void;
  createGame: (settings?: GameSettings) => Promise<Ack>;
  joinGame: (roomCode: string) => Promise<Ack>;
  setReady: (ready: boolean) => Promise<Ack>;
  startGame: () => Promise<Ack>;
  selectToken: (token: Token) => Promise<Ack>;
  guessToken: (token: Token) => Promise<Ack>;
  fillBox: (boxIndex: number) => Promise<Ack>;
  requestRematch: () => Promise<Ack>;
  leaveGame: () => Promise<Ack>;
  /** Leave any live room, THEN drop the session. Order matters. */
  signOut: () => Promise<void>;
  /** True while a match is running — signing out now would forfeit it. */
  inLiveGame: boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const { token, user, logout } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const viewRef = useRef<GameView | null>(null);

  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<GameView | null>(null);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pulseId = useRef(0);
  const firePulse = useCallback((p: Omit<Pulse, 'id'>) => {
    pulseId.current += 1;
    setPulse({ ...p, id: pulseId.current });
  }, []);

  useEffect(() => {
    if (!token) {
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
      setView(null);
      return;
    }

    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'UNAUTHENTICATED') {
        // A dead token can never recover by retrying — drop the session so the
        // app sends them to sign in rather than reconnecting forever.
        setNotice('Your session expired. Please sign in again.');
        logout();
      }
    });

    // The authoritative snapshot.
    socket.on('game_state', (next: GameView) => {
      viewRef.current = next;
      setView(next);
    });

    /* ── named events: animation and sound only ── */

    socket.on('countdown', ({ seconds }: { seconds: number }) => {
      setCountdown(seconds);
      sfx.countdown();
      firePulse({ kind: 'countdown', seconds });
    });

    socket.on('game_start', () => {
      setCountdown(null);
      sfx.go();
      firePulse({ kind: 'start' });
    });

    socket.on('number_selected', (e: NumberSelectedEvent) => {
      const mine = viewRef.current?.me?.seat === e.bySeat;
      if (!mine) sfx.select();
      firePulse({ kind: 'selected', value: e.value });
    });

    socket.on('correct_guess', (e: CorrectGuessEvent) => {
      const seat = viewRef.current?.me?.seat;
      if (seat === e.bySeat) {
        sfx.correct();
        firePulse({ kind: 'correct', value: e.value });
      } else if (seat === e.lockedSeat) {
        // The instant lock — the most important feedback in the game.
        sfx.lock();
        firePulse({ kind: 'locked', value: e.value });
      }
    });

    // A wrong guess is now public: the guesser feels the penalty, and the
    // opponent watches their rival's progress collapse.
    socket.on('wrong_guess', (e: { value: Token; bySeat: 1 | 2; boxesLost: number }) => {
      const seat = viewRef.current?.me?.seat;
      if (seat === e.bySeat) {
        if (e.boxesLost > 0) sfx.wipe();
        else sfx.wrong();
        firePulse({ kind: 'wrong', value: e.value, boxesLost: e.boxesLost });
      } else {
        firePulse({ kind: 'opponent_wrong', value: e.value, boxesLost: e.boxesLost });
      }
    });

    socket.on('game_finished', () => firePulse({ kind: 'finished' }));
    socket.on('player_disconnected', () => firePulse({ kind: 'opponent_left' }));
    socket.on('player_reconnected', () => firePulse({ kind: 'opponent_back' }));
    socket.on('opponent_forfeit', () => setNotice('Your opponent left the game.'));

    socket.on('action_rejected', ({ message }: { message: string }) => setNotice(message));

    return () => {
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, [token, firePulse, logout]);

  /** Every action carries the turnId of the snapshot it was taken under. */
  const send = useCallback((event: string, payload: Record<string, unknown> = {}): Promise<Ack> => {
    const socket = socketRef.current;
    if (!socket) return Promise.resolve({ ok: false, error: 'Not connected.' });
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err: Error | null, ack: Ack) => {
        resolve(err ? { ok: false, error: 'The server did not respond.' } : (ack ?? { ok: true }));
      });
    });
  }, []);

  const turnId = view?.turnId;
  const inLiveGame =
    !!view && view.status !== 'FINISHED' && view.status !== 'WAITING_FOR_PLAYER';

  const value = useMemo<GameContextValue>(
    () => ({
      connected,
      view,
      pulse,
      countdown,
      notice,
      dismissNotice: () => setNotice(null),
      createGame: (settings) => send('create_game', { ...(settings ?? {}) }),
      joinGame: (roomCode) => send('join_game', { roomCode }),
      setReady: (ready) => send('player_ready', { ready }),
      startGame: () => send('start_game'),
      selectToken: (token) => send('select_number', { value: token, turnId }),
      guessToken: (token) => send('guess_number', { value: token, turnId }),
      fillBox: (boxIndex) => send('fill_box', { boxIndex, turnId }),
      requestRematch: () => send('request_rematch'),
      leaveGame: () => send('leave_game'),
      inLiveGame,
      signOut: async () => {
        // Tell the server first: otherwise the seat stays occupied and the
        // player is only released when the reconnect grace period expires.
        if (view) await send('leave_game');
        logout();
      }
    }),
    [connected, view, pulse, countdown, notice, send, turnId, inLiveGame, logout]
  );

  // Keep the ref in step for listeners registered once.
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Sign-out should not leave a stale board on screen.
  useEffect(() => {
    if (!user) setView(null);
  }, [user]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
