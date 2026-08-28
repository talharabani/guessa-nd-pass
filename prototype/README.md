# GUESS AND PASS

Real-time two-player number hunt. Pixel-art wooden UI, Socket.IO, server-authoritative turns.

```bash
npm install
npm start
```

Open `http://localhost:3000` in two tabs, enter the same room code, press PLAY.

## The core rule

A player may fill boxes **only** while the opponent is actively searching for the
number they selected. The instant the opponent taps the correct number, the
filler is locked and the turn switches automatically — no button, no refresh.

```
selecting  ->  selector picks N        (nobody may fill)
searching  ->  seeker hunts N          (ONLY the selector may fill)
correct guess -> atomic transition     (filler locked, roles swap, seeker becomes selector)
```

## Where it is enforced

| Concern | Location |
| --- | --- |
| Phase/role state machine | [server.js](server.js) — `snapshotFor()` computes `canFillBoxes`, `canSelect`, `canGuess` |
| Atomic guess transition | [server.js](server.js) — the `guess` handler (validate → mark → lock → swap → broadcast, one synchronous block) |
| Stale-tap rejection | [server.js](server.js) — the `fillBox` handler checks phase, selector identity, and `turnId` |
| Client lock | [public/client.js](public/client.js) — `renderBoxes()` disables every box unless `state.canFillBoxes` |

`turnId` increments on every transition. Every client action carries the `turnId`
it was issued under, so a box tap that raced a successful guess arrives with a
stale id and is rejected. Node's single-threaded event loop runs each handler to
completion, so the guess and the fill can never interleave mid-update.

The client never advances the turn itself — the UI is rendered purely from the
last `state` snapshot the server broadcast.

## Test

```bash
npm test
```

Requires the server running (`npm start` in another terminal) and
`socket.io-client` installed. Covers: no filling during selection, target
auto-delivery, filling during search, the guess/fill race, instant lock, role
swap, auto-delivery of the next target, and wrong guesses not ending the turn.

## Tunables

`BOARD_NUMBERS` (36) and `TOTAL_BOXES` (10) at the top of [server.js](server.js).
First player to fill all boxes wins.

## UI

Pixel fantasy theme — dark wood, carved stone, gold. Built with CSS only (no image
assets): layered `box-shadow` bevels for the plank/frame edges, gradient wood grain,
and `Press Start 2P` / `VT323` from Google Fonts.

- **HUD** — two player cards with emblem, box pips, and a live role badge
  (`SEARCHING…` / `FILLING BOXES` / `CHOOSING…`); the acting player's card glows.
- **Stone tablet** — the target number, glowing gold while you hunt, green while
  it's yours, with a drop-in animation on every change.
- **Boxes** — carved slots that shimmer while unlocked, pop as gold when filled,
  and the lock bar slams shut the instant the opponent finds the number.
- **Board** — 6x6 beveled wooden tiles; found = gold, used = burnt out.
- **Turn banners** sweep across on every role change; screen flashes gold on a
  hit, red on a miss.
- **Sound** — WebAudio synth (no files): tap, fill, correct arpeggio, wrong
  slide, lock thud, win/lose fanfares. Toggle with the ♪ button.

Responsive down to phone width; the two-column stage collapses to one.
