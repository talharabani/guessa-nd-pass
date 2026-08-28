/**
 * A scripted opponent for manual/browser testing.
 *
 * Connects as a real authenticated socket client and plays the other seat, so a
 * single browser can be verified against a genuine second player. Not used by
 * the app or the test suite.
 *
 *   node bot.mjs <username> <password> <ROOMCODE>
 *
 * Behaviour: readies up; when it is the selector it picks a tile immediately and
 * fills nothing; when it is the hunter it waits (so you can bank boxes) and then
 * guesses correctly.
 */
import { io } from 'socket.io-client';

const [, , username, password, roomCode] = process.argv;
const BASE = process.env.SERVER_URL ?? 'http://localhost:4000';
const HUNT_DELAY_MS = Number(process.env.HUNT_DELAY_MS ?? 7000);

if (!username || !password || !roomCode) {
  console.error('usage: node bot.mjs <username> <password> <ROOMCODE>');
  process.exit(1);
}

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password })
});
if (!res.ok) {
  console.error('login failed', await res.text());
  process.exit(1);
}
const { token } = await res.json();

const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
const emit = (event, payload) => new Promise((r) => socket.emit(event, payload ?? {}, r));

let latest = null;
let busyUntilTurn = -1;

/**
 * Act on the newest snapshot. Keyed on turnId rather than a boolean lock, so a
 * state that arrives while an action is in flight is not swallowed.
 */
async function tick() {
  const view = latest;
  if (!view || view.turnId === busyUntilTurn) return;

  if (view.canSelect) {
    busyUntilTurn = view.turnId;
    const pick = view.me.board.find((t) => !view.usedTokens.includes(t));
    await emit('select_number', { value: pick, turnId: view.turnId });
    console.log(`bot selected ${pick} — now tap a WRONG tile to see the wipe`);
    tick();
    return;
  }

  if (view.canGuess) {
    busyUntilTurn = view.turnId;
    const { target, turnId } = view;
    console.log(`bot is hunting ${target}; will find it in ${HUNT_DELAY_MS}ms — fill boxes now`);
    setTimeout(async () => {
      await emit('guess_number', { value: target, turnId });
      console.log('bot found it — you are locked');
      tick();
    }, HUNT_DELAY_MS);
  }
}

socket.on('connect', async () => {
  console.log('bot connected');
  const ack = await emit('join_game', { roomCode: roomCode.toUpperCase() });
  console.log('join:', JSON.stringify(ack));
  await emit('player_ready', { ready: true });
  console.log('bot ready');
});

socket.on('game_state', (view) => {
  latest = view;
  void tick();
});

socket.on('wrong_guess', (e) => console.log('wrong_guess:', JSON.stringify(e)));
socket.on('game_finished', (e) => console.log('finished:', JSON.stringify(e)));
socket.on('action_rejected', (e) => console.log('rejected:', JSON.stringify(e)));
