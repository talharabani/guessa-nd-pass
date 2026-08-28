import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import type { GameView } from '../src/game/view.js';

/* ═══════════════════════════════════════════════════════════════════════════
   End-to-end multiplayer: two real socket clients against a real HTTP server.
   Nothing is stubbed — auth, rooms, engine and broadcasts all run for real.
   ═══════════════════════════════════════════════════════════════════════════ */

const { httpServer } = createApp();
let base = '';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function once<T = unknown>(socket: ClientSocket, event: string, timeout = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/**
 * Follows one client's snapshots. `until` checks the snapshot already in hand
 * before listening, so a state that arrived a tick earlier isn't missed — the
 * server pushes state before it pushes named events.
 */
interface Tracker {
  readonly current: GameView;
  until(predicate: (v: GameView) => boolean, timeout?: number): Promise<GameView>;
}

function track(socket: ClientSocket): Tracker {
  let latest: GameView | null = null;
  socket.on('game_state', (v: GameView) => (latest = v));
  return {
    get current(): GameView {
      if (!latest) throw new Error('no snapshot received yet');
      return latest;
    },
    until(predicate, timeout = 9000) {
      if (latest && predicate(latest)) return Promise.resolve(latest);
      return new Promise<GameView>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for a matching game_state')),
          timeout
        );
        const handler = (v: GameView) => {
          if (!predicate(v)) return;
          clearTimeout(timer);
          socket.off('game_state', handler);
          resolve(v);
        };
        socket.on('game_state', handler);
      });
    }
  };
}

const emit = <T>(socket: ClientSocket, event: string, payload?: unknown): Promise<T> =>
  new Promise((resolve) => socket.emit(event, payload, resolve as (r: T) => void));

async function registerUser(username: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'hunter2pass' })
  });
  const body = (await res.json()) as { token: string; user: { id: string; username: string } };
  expect(res.status).toBe(201);
  return body;
}

/**
 * Connects and pre-attaches listeners, because the server may emit
 * `session_restored` in the same tick the connection is established — a handler
 * added after the connect promise resolves can miss it.
 */
interface Client {
  socket: ClientSocket;
  /** Attached before the connection completes, so no early snapshot is lost. */
  state: Tracker;
  restored: Promise<{ roomCode: string }>;
  rejections: { code: string; message: string }[];
}

function connect(token: string): Promise<Client> {
  const socket = ioClient(base, { auth: { token }, transports: ['websocket'], forceNew: true });
  const state = track(socket);
  const rejections: { code: string; message: string }[] = [];
  socket.on('action_rejected', (r: { code: string; message: string }) => rejections.push(r));
  const restored = new Promise<{ roomCode: string }>((resolve) =>
    socket.once('session_restored', resolve)
  );
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve({ socket, state, restored, rejections }));
    socket.once('connect_error', reject);
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  httpServer.close();
});

describe('authentication', () => {
  it('rejects a socket with no token', async () => {
    const socket = ioClient(base, { transports: ['websocket'], forceNew: true });
    const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(err.message).toBe('UNAUTHENTICATED');
    socket.close();
  });

  it('treats usernames case-insensitively on sign in and sign up', async () => {
    // Registering with capitals...
    const created = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Talha', password: 'hunter2pass' })
    });
    expect(created.status).toBe(201);

    // ...then signing back in however you happen to type it must work. Getting
    // this wrong reads to the player as "my correct password is being rejected".
    for (const attempt of ['Talha', 'talha', 'TALHA', '  talha  ']) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: attempt, password: 'hunter2pass' })
      });
      expect(res.status, `login as ${JSON.stringify(attempt)}`).toBe(200);
      const body = (await res.json()) as { user: { username: string } };
      // and it is the SAME account, still displaying the original casing
      expect(body.user.username).toBe('Talha');
    }

    // A differently-capitalised name is the same account, so it cannot be taken twice.
    const dupe = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'TALHA', password: 'hunter2pass' })
    });
    expect(dupe.status).toBe(409);
  });

  it('labels failures with a code so the UI can offer a way out', async () => {
    await registerUser('codecheck');

    const taken = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'codecheck', password: 'hunter2pass' })
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'USERNAME_TAKEN' });

    const wrong = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'codecheck', password: 'wrongpass' })
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: 'BAD_CREDENTIALS' });

    // An unknown name must look identical to a wrong password — no enumeration.
    const unknown = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobodyhere', password: 'wrongpass' })
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ code: 'BAD_CREDENTIALS' });
  });

  it('still rejects a genuinely wrong password', async () => {
    await registerUser('pwcheck');
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'pwcheck', password: 'notmypassword' })
    });
    expect(res.status).toBe(401);
  });

  it('rejects duplicate usernames and bad passwords', async () => {
    await registerUser('dupuser');
    const again = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'dupuser', password: 'hunter2pass' })
    });
    expect(again.status).toBe(409);

    const bad = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'dupuser', password: 'wrongpass' })
    });
    expect(bad.status).toBe(401);
  });
});

describe('a full two-player match', () => {
  it('runs the whole loop: lobby → select → hunt → fill → lock → swap → win', async () => {
    const alpha = await registerUser('alpha_p1');
    const bravo = await registerUser('bravo_p2');
    const ca = await connect(alpha.token);
    const cb = await connect(bravo.token);
    const a = ca.socket;
    const b = cb.socket;
    const aState = ca.state;
    const bState = cb.state;

    /* ── lobby ── */
    const created = await emit<{ ok: boolean; roomCode?: string }>(a, 'create_game', { boxCount: 5 });
    expect(created.ok).toBe(true);
    const roomCode = created.roomCode!;
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

    const joinedEvent = once(a, 'player_joined');
    const joined = await emit<{ ok: boolean }>(b, 'join_game', { roomCode });
    expect(joined.ok).toBe(true);
    await joinedEvent; // host learns about the guest with no refresh

    expect(aState.current?.opponent?.username).toBe('bravo_p2');
    expect(bState.current?.me?.seat).toBe(2);
    // Boards are private: the opponent's tiles are never transmitted.
    expect((aState.current?.opponent as Record<string, unknown>)?.board).toBeUndefined();

    /* ── ready & start ── */
    await emit(a, 'player_ready', { ready: true });
    await emit(b, 'player_ready', { ready: true });
    const notHost = await emit<{ ok: boolean }>(b, 'start_game');
    expect(notHost.ok).toBe(false); // only the host may start

    const started = once<{ selectorSeat: number }>(a, 'game_start', 12000);
    await emit(a, 'start_game');
    await started;

    // BOTH clients must have the post-countdown snapshot before we read a
    // turnId off either of them — every action is validated against the turn
    // the acting client actually holds.
    const [selecting] = await Promise.all([
      aState.until((v) => v.status === 'SELECTING'),
      bState.until((v) => v.status === 'SELECTING')
    ]);
    expect(selecting.namedState).toMatch(/PLAYER_[12]_SELECTING/);

    /* ── work out who is who this round ── */
    let sel = aState.current.canSelect ? a : b;
    let seek = sel === a ? b : a;
    let selBox: Tracker = sel === a ? aState : bState;
    let seekBox: Tracker = sel === a ? bState : aState;

    expect(selBox.current.canFillBoxes).toBe(false); // nobody fills while selecting
    expect(seekBox.current.canFillBoxes).toBe(false);

    /* ── 1. select: the number appears on the opponent's screen by itself ── */
    const target = selBox.current.me!.board[0]!;
    const seekerGotTarget = seekBox.until((v) => v.target === target && v.canGuess);
    const selectAck = await emit<{ ok: boolean; error?: string }>(sel, 'select_number', {
      value: target,
      turnId: selBox.current.turnId
    });
    expect(
      selectAck,
      `select rejected. selBox=${JSON.stringify({
        turnId: selBox.current.turnId,
        status: selBox.current.status,
        canSelect: selBox.current.canSelect,
        seat: selBox.current.me!.seat
      })} other=${JSON.stringify({
        turnId: seekBox.current.turnId,
        status: seekBox.current.status
      })} rejections=${JSON.stringify(ca.rejections.concat(cb.rejections))}`
    ).toMatchObject({ ok: true });
    const seekerView = await seekerGotTarget;

    expect(seekerView.target).toBe(target); // no verbal step, no refresh
    expect(seekerView.canFillBoxes).toBe(false); // the searcher may NOT fill
    expect(seekerView.me!.board).toContain(target); // it really is on their board
    await selBox.until((v) => v.canFillBoxes === true);

    /* ── 2. parallel: the selector fills while the seeker hunts ── */
    await emit(sel, 'fill_box', { boxIndex: 0, turnId: selBox.current.turnId });
    await emit(sel, 'fill_box', { boxIndex: 1, turnId: selBox.current.turnId });
    const dupe = await emit<{ ok: boolean }>(sel, 'fill_box', { boxIndex: 1, turnId: selBox.current.turnId });
    expect(dupe.ok).toBe(false); // a box only counts once
    const cheat = await emit<{ ok: boolean }>(seek, 'fill_box', { boxIndex: 0 });
    expect(cheat.ok).toBe(false); // the searcher cannot fill

    await selBox.until((v) => v.me!.progress === 2);
    expect(seekBox.current.opponent!.progress).toBe(2); // opponent sees it live

    /* ── 3. a wrong guess: hunt continues, hunter's own boxes are wiped ── */
    // Give the hunter something to lose first.
    const seekerBefore = seekBox.current.me!.progress;
    const wrongN = seekBox.current.me!.board.find((t) => t !== target)!;
    const wrongEvent = once<{ value: string; boxesLost: number }>(seek, 'wrong_guess');
    await emit(seek, 'guess_number', { value: wrongN, turnId: seekBox.current.turnId });
    const wrongPayload = await wrongEvent;
    expect(wrongPayload).toMatchObject({ value: wrongN, boxesLost: seekerBefore });

    await seekBox.until((v) => v.me!.progress === 0);
    expect(seekBox.current.me!.stats.wrongGuesses).toBe(1);
    expect(seekBox.current.target).toBe(target); // still hunting
    expect(selBox.current.canFillBoxes).toBe(true); // opponent still filling
    // the opponent sees the collapse too — it is public drama, not a secret
    await selBox.until((v) => v.opponent!.progress === 0);
    expect(selBox.current.me!.progress).toBe(2); // and loses nothing themselves

    /* ── 4. correct guess: instant lock + role swap ── */
    const lockedTurn = selBox.current.turnId;
    const locked = selBox.until((v) => v.canFillBoxes === false);
    const swapped = seekBox.until((v) => v.canSelect === true);
    await emit(seek, 'guess_number', { value: target, turnId: seekBox.current.turnId });
    await Promise.all([locked, swapped]);

    expect(selBox.current.canFillBoxes).toBe(false); // LOCKED, instantly
    expect(selBox.current.me!.progress).toBe(2); // frozen where it stood
    expect(seekBox.current.role).toBe('selector'); // the finder now selects
    expect(seekBox.current.me!.completedTokens).toContain(target);

    // A tap that was already in flight under the old turn is rejected.
    const late = await emit<{ ok: boolean }>(sel, 'fill_box', { boxIndex: 2, turnId: lockedTurn });
    expect(late.ok).toBe(false);
    expect(selBox.current.me!.progress).toBe(2);

    /* ── 5. roles have swapped: repeat until someone wins ── */
    for (let guard = 0; guard < 20; guard++) {
      const finished = aState.current.status === 'FINISHED';
      if (finished) break;

      sel = aState.current.canSelect ? a : bState.current.canSelect ? b : sel;
      seek = sel === a ? b : a;
      selBox = sel === a ? aState : bState;
      seekBox = sel === a ? bState : aState;

      if (!selBox.current.canSelect) {
        await wait(30);
        continue;
      }

      const used = new Set(selBox.current.usedTokens);
      const n = selBox.current.me!.board.find((x) => !used.has(x))!;
      await emit(sel, 'select_number', { value: n, turnId: selBox.current.turnId });
      await selBox.until((v) => v.canFillBoxes === true);

      // fill everything still empty, then let the opponent find the number
      const turn = selBox.current.turnId;
      const empties = selBox.current.me!.filledBoxes.flatMap((f, i) => (f ? [] : [i]));
      for (const i of empties) await emit(sel, 'fill_box', { boxIndex: i, turnId: turn });

      if (selBox.current.status === 'FINISHED') break;
      await emit(seek, 'guess_number', { value: n, turnId: seekBox.current.turnId });
      await seekBox.until((v) => v.canSelect === true || v.status === 'FINISHED');
    }

    /* ── 6. the winner is whoever filled every box ── */
    // Both clients must have received the final broadcast before we compare.
    await Promise.all([
      aState.until((v) => v.status === 'FINISHED'),
      bState.until((v) => v.status === 'FINISHED')
    ]);
    const finalA = aState.current;
    const finalB = bState.current;
    expect(finalA.status).toBe('FINISHED');
    expect(finalB.status).toBe('FINISHED');
    expect(finalA.winnerUserId).toBe(finalB.winnerUserId);

    const winnerIsA = finalA.winnerUserId === finalA.me!.userId;
    const winnerView = winnerIsA ? finalA : finalB;
    expect(winnerView.me!.progress).toBe(5); // 5/5 boxes

    // everything is refused after the win
    const afterWin = await emit<{ ok: boolean }>(sel, 'fill_box', { boxIndex: 0 });
    expect(afterWin.ok).toBe(false);

    a.close();
    b.close();
  }, 40000);
});

describe('disconnect and reconnect', () => {
  it('preserves the whole game state and restores the session', async () => {
    const one = await registerUser('recon_p1');
    const two = await registerUser('recon_p2');
    const ca = await connect(one.token);
    let cb = await connect(two.token);
    const a = ca.socket;
    let b = cb.socket;
    const aState = ca.state;

    const created = await emit<{ ok: boolean; roomCode?: string }>(a, 'create_game', { boxCount: 6 });
    const roomCode = created.roomCode!;
    await emit(b, 'join_game', { roomCode });
    await emit(a, 'player_ready', { ready: true });
    await emit(b, 'player_ready', { ready: true });
    const started = once(a, 'game_start', 12000);
    await emit(a, 'start_game');
    await started;
    await aState.until((v) => v.status === 'SELECTING');

    // put the game into a known mid-round state
    let bState: Tracker = cb.state;
    await Promise.all([
      aState.until((v) => v.status === 'SELECTING'),
      bState.until((v) => v.status === 'SELECTING')
    ]);
    const sel = aState.current.canSelect ? a : b;
    const selBox = sel === a ? aState : bState;
    const target = selBox.current.me!.board[0]!;
    await emit(sel, 'select_number', { value: target, turnId: selBox.current.turnId });
    await selBox.until((v) => v.canFillBoxes === true);
    await emit(sel, 'fill_box', { boxIndex: 0, turnId: selBox.current.turnId });
    await selBox.until((v) => v.me!.progress === 1);

    const progressBefore = selBox.current.me!.progress;
    const turnBefore = aState.current.turnId;

    /* ── player two drops ── */
    const sawDrop = once<{ seat: number }>(a, 'player_disconnected');
    b.close();
    await sawDrop;
    await aState.until((v) => v.opponent!.connected === false);
    expect(aState.current.target).toBe(target); // game preserved, not restarted
    expect(aState.current.turnId).toBe(turnBefore);

    /* ── and comes back ── */
    cb = await connect(two.token);
    b = cb.socket;
    bState = cb.state;
    expect((await cb.restored).roomCode).toBe(roomCode);

    const back = await bState.until((v) => v.roomCode === roomCode);
    expect(back.target).toBe(target); // same target
    expect(back.turnId).toBe(turnBefore); // same turn
    expect(back.me!.board).toHaveLength(20); // same board
    await aState.until((v) => v.opponent!.connected === true);

    const restoredSelBox = sel === a ? aState : bState;
    expect(restoredSelBox.current.me!.progress).toBe(progressBefore); // progress intact

    a.close();
    b.close();
  }, 40000);
});
