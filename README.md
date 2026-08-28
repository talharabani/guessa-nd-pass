# Number Rush

A real-time two-player number race. Send your opponent a number, fill your boxes
while they hunt for it, and lock them out the moment you find theirs.

```
PLAYER 1 SELECTS 71
        ↓
PLAYER 2 SEES "FIND THIS: 71"           PLAYER 1 FILLS BOXES  ◄── at the same time
        ↓                                        ↓
PLAYER 2 TAPS THE WRONG TILE                     │
        ↓                                        │
PLAYER 2'S OWN BOXES → 0        the hunt continues, PLAYER 1 keeps filling
        ↓                                        ↓
PLAYER 2 TAPS 71  ────────────────────►  PLAYER 1 LOCKED, frozen where they stood
        ↓
ROLES INVERT — Player 2 selects, Player 1 hunts, Player 2 fills
        ↓
first player to fill EVERY box wins
```

Nobody ever waits. The player who is not searching always has a job, and finding
numbers fast is how you starve your opponent of filling time.

---

## The rules that matter

1. Players never speak a number aloud — it travels over the socket.
2. The selector taps a tile on their own board.
3. It appears on the opponent's screen instantly. No refresh, no "next turn" button.
4. The opponent hunts it on **their own** board — the same tiles, shuffled differently.
   Nothing on that board marks the answer: while you are hunting, every tile looks identical.
5. While they hunt, and **only** then, the selector fills blank boxes. One tap, one box — 100 of them.
6. The instant the hunter taps correctly, the filler is locked and the roles invert.
7. **A wrong tap wipes every box you have banked.** The turn does not switch and the
   tile stays live — your opponent keeps filling while you keep hunting — but your
   own progress goes to zero. Boxes are earned as the selector and destroyed by
   carelessness as the hunter.
8. The winner is whoever fills every box first — not whoever finds numbers fastest.
9. The server decides all of it. The client only renders and animates.

---

## Board content

The host picks what the tiles are made of when creating the game. Both players
share one set, so it is the host's call — the lobby shows the joining player what
they are walking into.

| Mode | Tiles | Max board |
| --- | --- | --- |
| **Numbers** | `1` – `99` | 36 |
| **Letters** | `A` – `Z` | 26 |
| **Symbols** | `★ ♦ ⚙ ♠ ☂ …` | 36 |
| **Mixed** | letters and numbers together — hardest to scan | 36 |

A board tile is a **token** — an opaque string. Digits are simply the token set
whose members look like numbers, which is why nothing in the engine does
arithmetic on a tile. Adding another set means adding an array to
`apps/server/src/game/content.ts`; nothing else changes.

Board size is capped by the chosen set — 26 letters cannot fill a 34-tile board,
and the setup control reflects that as you switch, rather than letting you pick
something the server would silently clamp.

Symbols avoid emoji on purpose: emoji render differently across platforms, and
two players must see the same shape.

## Running it locally

```bash
npm install
```

Then two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Open http://localhost:3000 in **two different browsers** (two accounts are needed —
two tabs of the same browser share one login). Register in each, create a game in
one, join with the code in the other.

`DATABASE_URL` can be left blank in development: the server falls back to a local
store and says so at boot. Accounts are written to `apps/server/.data/users.json`
(hashed, never plaintext) so they survive a restart; matches stay in memory. See
[DEPLOYMENT.md](DEPLOYMENT.md) for Postgres.

That store is **memory-first**: the file is read once at boot and thereafter only
written. Editing or deleting it while the server is running has no effect — the
process still holds every account and writes them straight back on the next
sign-up. To clear local accounts, stop the server, then:

```bash
rm apps/server/.data/users.json
```

and start it again. None of this applies to Postgres, which is read live.

### Environment

Copy the examples and edit:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
```

---

## Layout

```
apps/
  server/                  Express + Socket.IO + Prisma
    src/
      game/
        content.ts         token alphabets: digits, letters, symbols, mixed
        types.ts           state machine, events, reject codes
        engine.ts          ◄── the authoritative rules. pure, no I/O
        view.ts            per-player snapshot (opponent's board never leaves)
        rooms.ts           live rooms, sockets per user, timers
        boards.ts          shared pool + independent shuffles
      sockets/index.ts     validate → engine → broadcast
      auth/                register / login / me, bcrypt + JWT
      db/index.ts          Prisma, with an in-memory fallback
      env.ts               validated config; refuses unsafe production boots
    prisma/schema.prisma   User, Game, GamePlayer
    tests/                 43 engine tests + 7 multiplayer socket tests
  web/                     Next.js App Router
    app/                   login, register, home, how-to-play, settings, lobby, game
    components/
      AuthProvider.tsx     session + token
      AuthForm.tsx         one form for sign in and sign up
      AccountBar.tsx       who you are, and signing out safely
      GameSettings.tsx     content type, box count, board size
      GameProvider.tsx     the socket, the snapshot, the animation pulses
      game/                HUD, target, number board, boxes, overlays
      ui/                  Button, Panel, Field, Progress, Modal, Toast
    app/globals.css        ◄── every colour, radius, shadow. re-skin here
```

---

## How the core rule is enforced

**Permissions are derived, never stored.** Three booleans, computed fresh on every
snapshot in `engine.ts`:

```ts
canFillBoxes = status === 'GUESSING' && selectorSeat === yourSeat && !winner
canGuess     = status === 'GUESSING' && selectorSeat !== yourSeat && !winner
canSelect    = status === 'SELECTING' && selectorSeat === yourSeat && !winner
```

There is no code path that opens box filling during selection, and none that lets
the searcher fill. The client receives these booleans and mirrors them — it never
decides for itself.

**The switch is atomic.** A correct guess runs one synchronous block: mark found →
clear target → make the finder the selector → bump `turnId` → broadcast. Node runs
the handler to completion, so no box fill can interleave halfway through.

**Stale actions are rejected.** `turnId` increments on every transition, and each
client action carries the `turnId` of the snapshot it was taken under. A box tap
that left the browser at the same moment as the winning guess arrives against a
turn that no longer exists and is refused.

**The client is never trusted.** `fillBox(index)` is validated against the
server-owned array: out of range, already filled, wrong phase, wrong player, game
over — all rejected. A hostile client cannot set `progress = 100`.

**The penalty is server-side too.** A wrong guess wipes `filledBoxes` on the
server and broadcasts the new snapshot to both clients — the opponent watches the
bar collapse. It never touches the *selector's* boxes, and it never switches the
turn or reveals the target.

**The hunter is never shown the answer.** A selected number is marked used the
instant it is chosen, so that it can never be picked twice. That made it visible:
the hunter's board greyed out used numbers, which meant the live target — a used
number — was the one highlighted tile on their board. Fixed at both layers.
`snapshotFor()` withholds the active target from the hunter's `usedNumbers`, so
the information never reaches them; and the board only renders history while you
are selecting, never while you are hunting. Two engine tests hold this in place.

---

## Tests

```bash
npm test
```

50 tests, no mocks in the multiplayer suite — it runs a real HTTP server with two
real socket clients.

**Engine (43):** board generation and the shared-pool guarantee · room capacity ·
host-only start · permissions in every phase · selection validity (out of turn,
off-board, reused, stale) · wrong guesses wiping the hunter's boxes while leaving the
selector's untouched, the turn intact and the target live · correct guesses
inverting roles · double-guess rejection · one fill per box · out-of-range boxes ·
the searcher being unable to fill · the instant lock · the `turnId` guard on its
own · winning on boxes rather than finds · everything refused after a win · a
six-round alternating race · pool exhaustion dealing fresh boards ·
disconnect/reconnect preserving state · two-sided rematch · the live target being
withheld from the hunter and restored the moment the round ends · 100 boxes by
default, with 99/100 explicitly not a win · every content type dealing the right
tiles, both boards sharing one set, alphabets clamping the board size, and a full
round played on letters · match stats (finds, wrong guesses, best
streak, boxes lost) and their reset on a rematch.

**Multiplayer (7):** socket auth rejection · duplicate usernames and bad passwords ·
case-insensitive sign-in (`Talha` / `talha` / `TALHA` / padded all reach one
account, and the duplicate is refused) · a genuinely wrong password still 401s ·
error codes (`USERNAME_TAKEN` / `BAD_CREDENTIALS`) with an unknown username still
indistinguishable from a wrong password ·
a complete match from lobby to victory, including the fill/guess race and the
opponent's board never being transmitted · disconnect and reconnect restoring the
target, turn, board and progress.

---

## Verified end to end

Driven through two real browsers against the running stack:

| Check | Result |
| --- | --- |
| Guest appears in host's lobby | live, no refresh |
| Both clients enter the game | automatic, after a shared countdown |
| Boards | same 20 numbers, different arrangements |
| Selector picks a number | opponent's screen shows `NUMBER TO GUESS` by itself |
| Boxes dealt | 100 per player, `0/100` |
| During the hunt | selector unlocked, hunter locked |
| Wrong tap | target stayed live, opponent kept filling |
| **Hunter's board with 3 numbers spent** | 0 styled tiles; target tile identical to every other in class, background, opacity, border and colour |
| Selector's own board | history still shown — spent numbers greyed, found ones green |
| Correct tap | filler frozen at 12/100, **0 of 88 remaining boxes enabled**, roles inverted |
| Win | 🏆 winner + 💥 loser screens with final scores |
| Rematch | both reset, fresh boards, new starting player |
| **Wrong guess** | 12 banked → **0**, banner `✕ WRONG −12 BOXES`; DOM-recorded `shake ×2`, `boxWipe` on all 100 boxes, grid flash |
| Wrong guess (opponent's view) | rival's bar collapses live; own progress untouched |
| Winner stats | `TILES FOUND 1 · WRONG GUESSES 1 · BEST STREAK 1 · BOXES LOST 0` — matching the moves played |
| Race HUD | crown on the leader, `+12` gap, `⚡ FILLING` / `🔍 SEARCHING` |
| Sign up → sign out → sign in | account created, token cleared, redirected to `/login`, username prefilled, signed back in |
| Sign in with different casing | typed `realplayer_9`, signed into `RealPlayer_9` |
| Sign out mid-match | confirmation shown; "Stay" keeps the session, "Leave and sign out" releases the seat then signs out |
| Taken username at sign-up | error offers `Sign in as RealPlayer_9 instead →`, which lands on `/login` with the name filled in |
| Wrong password | `Incorrect username or password.` plus the case-sensitivity hint |
| Mobile at 375px | no horizontal overflow on game, home, setup or settings |
| Symbols game | 26-tile ♠♣⌘ board, 100 boxes, `Your symbol ♠` vs `Find this ♠` |
| Letters cap | 34 tiles clamped to 26 on switching to letters, hint updated |
| Sign-up validation | short username and password blocked with exact messages |
| Accounts after restart | `restored 2 local account(s)`, login 200, wrong password 401 |

---

## Accounts

Usernames are **case-insensitive**: register as `Talha` and you can sign back in
as `talha`, `TALHA`, or with stray spaces. The display name keeps the casing you
chose. Postgres carries a separate lower-cased column holding the real uniqueness
constraint, so two accounts differing only in capitalisation cannot exist —
without it, `findUnique` matches exactly and a correct password reads as wrong.

There is **no password recovery** — no email is collected, so a forgotten password
means the account is unreachable and you pick a new username. Because of that, a
taken username at sign-up offers a one-tap route to sign in as that name instead
of leaving you bouncing between the two screens, and a failed sign-in points out
that passwords are case-sensitive while usernames are not.

Signing out leaves any room you are seated in *before* dropping the session;
otherwise the seat stays occupied until the reconnect grace period expires.
Signing out mid-match asks first, since it hands your opponent the win. The login
form remembers the last username used on the device, so returning is one field.

## Polish pass

- **The race HUD** shows both bars, the live gap (`+12` / `LEVEL`), a crown on the
  leader, and what each player is doing right now.
- **The wrong-guess moment** is the game's biggest swing, so it gets the biggest
  reaction: screen shake, a red grid flash, all boxes wiping in a staggered
  ripple, `✕ WRONG −12 BOXES`, a heavier sound and a triple haptic.
- **Rendering.** Tiles and boxes are memoised. At 100 boxes with a snapshot on
  every tap, an un-memoised grid re-renders 100 nodes per fill; now only the box
  that changed does any work.
- **Loading states** name the step (`Restoring your match`, `Joining the room`)
  instead of showing a bare spinner.
- **Banners are short** (1.15s) and never block input — they must not sit between
  a guess and the next tap.

`apps/server/bot.mjs` is a scripted opponent for manual testing: it logs in as a
real socket client and plays the other seat, so one browser can be tested against
a genuine second player.

```bash
node bot.mjs <username> <password> <ROOMCODE>
```

## Notes and limits

- **Theme.** The visual language is deliberately neutral and lives entirely in
  design tokens at the top of `apps/web/app/globals.css`. Supply the reference
  image and the re-skin is that one block — components reference tokens only.
- **`next build` in a hardened sandbox.** Next forks a jest-worker child process to
  build. Environments that deny `child_process.fork` fail with `spawn EPERM`. This
  is environmental, not a code fault: `next dev` and `tsc --noEmit` both pass, and
  the build runs normally on Vercel and on an ordinary machine.
- **One backend instance.** Match state is in-process. See the scaling note in
  [DEPLOYMENT.md](DEPLOYMENT.md).
- **`prototype/`** holds the first single-file version of this game, kept only for
  reference. Nothing depends on it and it can be deleted.

## Tuning

`apps/server/src/game/types.ts` → `DEFAULT_CONFIG`:

```ts
boxCount: 100          // boxes to fill to win
boardSize: 20          // tiles per board
contentType: 'DIGITS'  // DIGITS | LETTERS | SYMBOLS | MIXED
countdownSeconds: 3
reconnectGraceMs: 60_000
```

These are only defaults — the host overrides them per game from the setup panel,
and the server clamps whatever arrives (5–200 boxes, 9 tiles up to the alphabet's
size, and an unknown content type falls back to digits).
