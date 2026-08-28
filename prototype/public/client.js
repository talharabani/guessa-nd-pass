'use strict';

/* ═══════════════════════════════════════════════════════════════════
   GUESS & PASS — client
   The UI is a pure function of the last server snapshot. The client
   never advances the turn on its own; it only renders and animates.
   ═══════════════════════════════════════════════════════════════════ */

const socket = io();
const el = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

let state = null;   // last authoritative snapshot
let prev = null;    // the one before it, for diff-driven animation

/* ────────────────────────────── audio ───────────────────────────── */
const Sfx = (() => {
  let ctx = null, on = true;
  const ready = () => {
    if (!on) return null;
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, dur, type, vol, delay) {
    const c = ready(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.09, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  function slide(from, to, dur, type, vol) {
    const c = ready(); if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  return {
    toggle() { on = !on; if (on) ready(); return on; },
    tap()    { tone(300, 0.05, 'square', 0.05); },
    fill()   { slide(520, 900, 0.12, 'square', 0.07); },
    wrong()  { slide(200, 70, 0.22, 'sawtooth', 0.07); },
    correct(){ [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.08, i * 0.07)); },
    lock()   { slide(180, 55, 0.3, 'square', 0.09); },
    turn()   { tone(660, 0.09, 'triangle', 0.07); tone(880, 0.11, 'triangle', 0.07, 0.09); },
    win()    { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'square', 0.09, i * 0.1)); },
    lose()   { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.24, 'sawtooth', 0.07, i * 0.12)); }
  };
})();

el('soundBtn').addEventListener('click', e => {
  e.currentTarget.classList.toggle('off', !Sfx.toggle());
});

/* ──────────────────────────── join flow ─────────────────────────── */
function join() {
  Sfx.tap();
  socket.emit('join', {
    name: el('nameInput').value || 'HERO',
    room: el('roomInput').value || 'LOBBY'
  });
}
el('joinBtn').addEventListener('click', join);
['nameInput', 'roomInput'].forEach(id =>
  el(id).addEventListener('keydown', e => { if (e.key === 'Enter') join(); })
);

/* ─────────────────────── server → client events ─────────────────── */
socket.on('state', snap => {
  prev = state;
  state = snap;

  el('screen-title').classList.remove('is-active');
  el('screen-game').classList.add('is-active');

  render();
  reactTo(state.lastEvent);
});

socket.on('rejected', ({ reason }) => { toast(reason); });

socket.on('wrong', ({ number }) => {
  const cell = document.querySelector('.cell[data-n="' + number + '"]');
  if (cell) { cell.classList.add('miss'); setTimeout(() => cell.classList.remove('miss'), 320); }
  flash('bad');
  Sfx.wrong();
});

/* ──────────────────────────── rendering ─────────────────────────── */
function render() {
  el('roomTag').textContent = state.room;
  el('turnTag').textContent = state.turnId;
  renderCards();
  renderTablet();
  renderBoxes();
  renderBoard();
  renderOverlay();
}

function roleWord(isSelector, phase) {
  if (phase === 'searching') return isSelector ? ['FILLING BOXES', 'r-fill'] : ['SEARCHING…', 'r-seek'];
  if (phase === 'selecting') return isSelector ? ['CHOOSING…', 'r-fill'] : ['STANDING BY', 'r-wait'];
  return ['WAITING', 'r-wait'];
}

function renderCards() {
  const me = state.me, foe = state.opponent;
  const iAmSelector = state.role === 'selector';

  el('nameMe').textContent = me ? me.name : 'YOU';
  el('faceMe').textContent = me ? me.name.charAt(0) : '?';
  el('nameFoe').textContent = foe ? foe.name : 'WAITING…';
  el('faceFoe').textContent = foe ? foe.name.charAt(0) : '?';

  const [rMe, cMe] = roleWord(iAmSelector, state.phase);
  const [rFoe, cFoe] = roleWord(!iAmSelector, state.phase);
  el('roleMe').textContent = state.phase === 'waiting' ? 'WAITING' : rMe;
  el('roleMe').className = 'pcard-role ' + cMe;
  el('roleFoe').textContent = foe ? (state.phase === 'waiting' ? 'WAITING' : rFoe) : '—';
  el('roleFoe').className = 'pcard-role ' + (foe ? cFoe : 'r-wait');

  // the card of whoever is acting right now glows
  el('pcardMe').classList.toggle('is-active', state.canSelect || state.canGuess);
  el('pcardFoe').classList.toggle('is-active', !!foe && state.phase !== 'waiting' && !(state.canSelect || state.canGuess));

  pips('pipsMe', me ? me.boxes : 0);
  pips('pipsFoe', foe ? foe.boxes : 0);
}

function pips(id, filled) {
  const wrap = el(id);
  if (wrap.children.length !== state.totalBoxes) {
    wrap.innerHTML = '';
    for (let i = 0; i < state.totalBoxes; i++) {
      const d = document.createElement('i');
      d.className = 'pip';
      wrap.appendChild(d);
    }
  }
  for (let i = 0; i < state.totalBoxes; i++) {
    wrap.children[i].classList.toggle('on', i < filled);
  }
}

function renderTablet() {
  const tablet = el('tablet');
  const label = el('targetLabel');
  const num = el('targetNumber');
  const sub = el('targetSub');
  tablet.classList.remove('lit', 'hunt', 'mine');

  if (state.phase === 'waiting') {
    label.textContent = 'WAITING FOR OPPONENT';
    num.textContent = '--';
    sub.textContent = 'Share room code ' + state.room;
  } else if (state.phase === 'finished') {
    label.textContent = 'GAME OVER';
    num.textContent = '★';
    sub.textContent = ' ';
  } else if (state.phase === 'selecting') {
    if (state.canSelect) {
      label.textContent = 'PICK A NUMBER';
      num.textContent = '?';
      sub.textContent = 'Tap any open tile on your board.';
      tablet.classList.add('lit');
    } else {
      label.textContent = 'OPPONENT IS PICKING';
      num.textContent = '···';
      sub.textContent = 'Your boxes are locked.';
    }
  } else if (state.role === 'selector') {
    label.textContent = 'YOUR NUMBER';
    num.textContent = state.target;
    sub.textContent = (state.opponent ? state.opponent.name : 'Opponent') + ' is searching…';
    tablet.classList.add('mine', 'lit');
  } else {
    label.textContent = 'NUMBER TO GUESS';
    num.textContent = state.target;
    sub.textContent = 'FIND IT — FAST!';
    tablet.classList.add('hunt');
  }

  // animate whenever the displayed value actually changes
  if (num.dataset.shown !== num.textContent) {
    num.dataset.shown = num.textContent;
    num.classList.remove('swap');
    void num.offsetWidth;
    num.classList.add('swap');
  }
}

function renderBoxes() {
  const wrap = el('boxes');
  const total = state.totalBoxes;
  const filled = state.me ? state.me.boxes : 0;
  const open = !!state.canFillBoxes;

  if (wrap.children.length !== total) {
    wrap.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const b = document.createElement('button');
      b.className = 'box';
      b.addEventListener('click', fillBox);
      wrap.appendChild(b);
    }
  }

  const wasFilled = prev && prev.me ? prev.me.boxes : filled;
  for (let i = 0; i < total; i++) {
    const b = wrap.children[i];
    const isFilled = i < filled;
    if (isFilled && i >= wasFilled) {          // just landed → pop
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    }
    b.classList.toggle('filled', isFilled);
    b.disabled = !open || isFilled;            // hard client-side lock
  }
  wrap.classList.toggle('is-open', open);

  const bar = el('lockbar');
  el('lockText').textContent = open ? 'FILLING UNLOCKED' : 'LOCKED';
  bar.className = 'lockbar ' + (open ? 'is-open' : 'is-locked');
  bar.querySelector('.lock-ico').textContent = open ? '🔓' : '🔒';
  el('boxNote').textContent = open
    ? 'Tap fast — this ends the instant they find it.'
    : 'Fill only while your opponent searches.';
}

function renderBoard() {
  const board = el('board');
  const me = state.me;
  if (!me) { board.innerHTML = ''; return; }

  if (board.children.length !== me.board.length) {
    board.innerHTML = '';
    me.board.forEach(n => {
      const c = document.createElement('button');
      c.className = 'cell';
      c.dataset.n = n;
      c.textContent = n;
      c.addEventListener('click', () => tapCell(n));
      board.appendChild(c);
    });
  }

  const used = new Set(state.usedNumbers);
  const found = new Set(me.found);
  const active = state.canSelect || state.canGuess;

  el('boardLabel').textContent = state.canSelect
    ? 'TAP A TILE TO SELECT IT'
    : state.canGuess ? 'FIND ' + state.target + ' ON YOUR BOARD' : 'YOUR BOARD';

  board.classList.toggle('is-hunt', !!state.canGuess);

  Array.prototype.forEach.call(board.children, c => {
    const n = Number(c.dataset.n);
    c.classList.toggle('hit', found.has(n));
    c.classList.toggle('used', used.has(n) && !found.has(n));
    // Used numbers can't be selected again, but during a hunt every tile
    // stays tappable so the seeker can search freely.
    c.disabled = !active || (state.canSelect && used.has(n));
  });
}

function renderOverlay() {
  const ov = el('overlay');
  if (state.phase !== 'finished') { ov.classList.remove('show'); return; }
  const iWon = state.me && state.winnerId === state.me.id;
  el('overlayCrown').textContent = iWon ? '★' : '☠';
  el('overlayText').textContent = iWon ? 'VICTORY!' : 'DEFEAT';
  el('overlayText').className = 'overlay-text' + (iWon ? '' : ' lose');
  el('overlayScore').textContent =
    (state.me ? state.me.boxes : 0) + ' — ' + (state.opponent ? state.opponent.boxes : 0) + ' BOXES';
  ov.classList.add('show');
}

el('restartBtn').addEventListener('click', () => { Sfx.tap(); socket.emit('restart'); });

/* ───────────────────────────── actions ──────────────────────────── */
function tapCell(n) {
  if (!state) return;
  if (state.canSelect) {
    Sfx.tap();
    socket.emit('select', { number: n, turnId: state.turnId });
  } else if (state.canGuess) {
    socket.emit('guess', { number: n, turnId: state.turnId });
  }
}

function fillBox() {
  if (!state || !state.canFillBoxes) return;   // server re-checks anyway
  Sfx.fill();
  socket.emit('fillBox', { turnId: state.turnId });
}

/* ─────────────────── event reactions (banners / sfx) ────────────── */
function reactTo(e) {
  if (!e || (prev && prev.version === state.version)) return;
  const myId = state.me ? state.me.id : null;

  switch (e.type) {
    case 'start':
      banner(state.canSelect ? 'YOU SELECT FIRST' : 'OPPONENT SELECTS');
      Sfx.turn();
      break;

    case 'selected':
      if (state.role === 'seeker') { banner('FIND ' + e.number); Sfx.turn(); }
      else { banner('FILL YOUR BOXES!'); Sfx.turn(); }
      break;

    case 'guessed': {
      const byMe = e.by === myId;
      const lockedMe = e.lockedPlayer === myId;
      if (byMe) {
        const cell = document.querySelector('.cell[data-n="' + e.number + '"]');
        if (cell) { cell.classList.remove('hit-now'); void cell.offsetWidth; cell.classList.add('hit-now'); }
        flash('go');
        Sfx.correct();
        banner('FOUND ' + e.number + ' — YOUR TURN');
      } else if (lockedMe) {
        // the instant lock, made visible
        const bar = el('lockbar');
        bar.classList.remove('slam'); void bar.offsetWidth; bar.classList.add('slam');
        Sfx.lock();
        banner('THEY FOUND ' + e.number + ' — LOCKED', true);
      }
      break;
    }

    case 'win':
      if (e.by === myId) Sfx.win(); else Sfx.lose();
      break;

    case 'left':
      banner('OPPONENT LEFT', true);
      break;

    case 'waiting':
      break;
  }
}

/* ──────────────────────── small UI helpers ─────────────────────── */
let bannerTimer = null;
function banner(text, isBad) {
  const b = el('banner');
  el('bannerText').textContent = text;
  b.classList.toggle('bad', !!isBad);
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 1500);
}

let toastTimer = null;
function toast(text) {
  const t = el('toast');
  t.textContent = text;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
}

function flash(kind) {
  const f = el('flash');
  f.className = 'flash';
  void f.offsetWidth;
  f.classList.add(kind);
}
