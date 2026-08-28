const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

const wait = (sock, ev) => new Promise(r => sock.once(ev, r));
const fail = m => { console.log('FAIL: ' + m); process.exit(1); };

(async () => {
  const p1 = io(URL), p2 = io(URL);
  const s1 = [], s2 = [];
  const rejects1 = [];
  p1.on('state', s => s1.push(s));
  p2.on('state', s => s2.push(s));
  p1.on('rejected', r => rejects1.push(r.reason));

  p1.emit('join', { name: 'ONE', room: 'TEST' });
  await new Promise(r => setTimeout(r, 150));
  p2.emit('join', { name: 'TWO', room: 'TEST' });
  await new Promise(r => setTimeout(r, 250));

  let a = s1[s1.length - 1], b = s2[s2.length - 1];
  if (a.role !== 'selector' || b.role !== 'seeker') fail('initial roles wrong');
  if (a.canFillBoxes || b.canFillBoxes) fail('boxes open during selection phase');
  console.log('OK  selection phase: nobody can fill boxes');

  // P1 selects 71-equivalent -> pick a number from its own board
  const pick = a.me.board[0];
  p1.emit('select', { number: pick, turnId: a.turnId });
  await new Promise(r => setTimeout(r, 200));
  a = s1[s1.length - 1]; b = s2[s2.length - 1];
  if (b.target !== pick) fail('target not broadcast to seeker automatically');
  if (!a.canFillBoxes) fail('selector cannot fill during search');
  if (b.canFillBoxes) fail('seeker can fill during search');
  console.log('OK  search phase: P2 auto-receives target ' + pick + ', only P1 may fill');

  // P1 fills 3 boxes
  for (let i = 0; i < 3; i++) { p1.emit('fillBox', { turnId: a.turnId }); }
  await new Promise(r => setTimeout(r, 200));
  a = s1[s1.length - 1];
  if (a.me.boxes !== 3) fail('expected 3 boxes, got ' + a.me.boxes);
  console.log('OK  P1 filled 3 boxes while P2 searched');

  const staleTurn = a.turnId;

  // Race: P2 guesses correctly and P1 taps a box in the same tick.
  p2.emit('guess', { number: pick, turnId: b.turnId });
  p1.emit('fillBox', { turnId: staleTurn });
  await new Promise(r => setTimeout(r, 300));

  a = s1[s1.length - 1]; b = s2[s2.length - 1];
  if (a.me.boxes !== 3) fail('box filled after guess! boxes=' + a.me.boxes);
  if (a.canFillBoxes) fail('P1 still unlocked after opponent guessed');
  if (a.role !== 'seeker' || b.role !== 'selector') fail('roles did not swap');
  if (b.phase !== 'selecting') fail('phase not selecting after guess');
  console.log('OK  correct guess -> P1 locked at 3 boxes, roles swapped instantly');
  console.log('OK  stale fill rejected: ' + JSON.stringify(rejects1));

  // New selector picks; old selector automatically becomes the searcher.
  const pick2 = b.me.board[5];
  p2.emit('select', { number: pick2, turnId: b.turnId });
  await new Promise(r => setTimeout(r, 200));
  a = s1[s1.length - 1]; b = s2[s2.length - 1];
  if (a.target !== pick2) fail('P1 did not auto-receive new target');
  if (!b.canFillBoxes || a.canFillBoxes) fail('fill permission did not follow the selector');
  console.log('OK  P2 selected ' + pick2 + ' -> P1 screen auto-updated, P2 now filling');

  // Wrong guess must not switch the turn.
  const wrongN = a.me.board.find(n => n !== pick2);
  const turnBefore = a.turnId;
  p1.emit('guess', { number: wrongN, turnId: turnBefore });
  await new Promise(r => setTimeout(r, 200));
  a = s1[s1.length - 1];
  if (a.turnId !== turnBefore || a.phase !== 'searching') fail('wrong guess changed the turn');
  console.log('OK  wrong guess keeps the turn open');

  console.log('\nALL CHECKS PASSED');
  p1.close(); p2.close();
  process.exit(0);
})();
