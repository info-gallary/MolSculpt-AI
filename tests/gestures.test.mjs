// Tests for the gesture layer using synthetic 21-point hands (normalised
// image coordinates, camera not mirrored). These verify the interaction
// logic: they are not a measure of recognition accuracy on real users.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPose, GestureInterpreter } from '../public/js/input/gestures.js';
import { OneEuroFilter } from '../public/js/input/one-euro.js';
import { parseVoice } from '../public/js/input/voice.js';

const MCP = { index: [0.44, 0.62], middle: [0.49, 0.6], ring: [0.54, 0.61], pinky: [0.58, 0.64] };
const ORDER = ['index', 'middle', 'ring', 'pinky'];

/** Build a hand: fingers 'ext' | 'curl'; thumb 'out' | 'up' | 'tucked' | [x, y] tip. */
function hand({ fingers = {}, thumb = 'out', pinch = false, dx = 0 } = {}) {
  const pts = new Array(21);
  pts[0] = [0.5, 0.85];
  ORDER.forEach((f, k) => {
    const [x, y] = MCP[f];
    const base = 5 + k * 4;
    pts[base] = [x, y];
    if ((fingers[f] ?? 'ext') === 'ext') {
      pts[base + 1] = [x, y - 0.08]; pts[base + 2] = [x, y - 0.13]; pts[base + 3] = [x, y - 0.175];
    } else {
      pts[base + 1] = [x, y - 0.05]; pts[base + 2] = [x + 0.01, y - 0.02]; pts[base + 3] = [x + 0.005, y + 0.03];
    }
  });
  if (thumb === 'up') { pts[1] = [0.43, 0.8]; pts[2] = [0.4, 0.7]; pts[3] = [0.39, 0.58]; pts[4] = [0.385, 0.48]; }
  else if (thumb === 'tucked') { pts[1] = [0.43, 0.8]; pts[2] = [0.4, 0.73]; pts[3] = [0.42, 0.68]; pts[4] = [0.47, 0.66]; }
  else { pts[1] = [0.43, 0.8]; pts[2] = [0.38, 0.73]; pts[3] = [0.34, 0.67]; pts[4] = [0.3, 0.62]; }
  if (pinch) {
    pts[6] = [0.43, 0.56]; pts[7] = [0.41, 0.55]; pts[8] = [0.4, 0.56];
    pts[3] = [0.39, 0.62]; pts[4] = [0.405, 0.565];
  }
  return pts.map(([x, y]) => ({ x: x + dx, y, z: 0 }));
}

const mirrored = (lm) => lm.map((p) => ({ x: (1 - p.x) * (4 / 3), y: p.y }));

test('static poses are classified', () => {
  const cases = [
    [hand(), 'open_palm'],
    [hand({ fingers: { middle: 'curl', ring: 'curl', pinky: 'curl' } }), 'point'],
    [hand({ fingers: { ring: 'curl', pinky: 'curl' } }), 'victory'],
    [hand({ fingers: { pinky: 'curl' } }), 'three'],
    [hand({ fingers: { index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' }, thumb: 'tucked' }), 'fist'],
    [hand({ fingers: { index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' }, thumb: 'up' }), 'thumbs_up'],
  ];
  for (const [lm, expected] of cases) assert.equal(classifyPose(mirrored(lm)).pose, expected);
});

test('pinch distance is small only for a pinch, and a fist is not a pinch', () => {
  assert.ok(classifyPose(mirrored(hand({ pinch: true }))).pinch < 0.3);
  assert.ok(classifyPose(mirrored(hand())).pinch > 0.45);
  const fist = classifyPose(mirrored(hand({ fingers: { index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' }, thumb: 'tucked' })));
  assert.equal(fist.indexBent, false);
});

function run(frames, { reach = 0.6 } = {}) {
  const g = new GestureInterpreter(() => ({ reach, smoothing: 1.2, pinch: 0.3 }), () => ({ w: 1600, h: 900 }));
  const events = [];
  for (const type of ['down', 'up', 'cancel', 'command', 'lost', 'found']) g.addEventListener(type, (e) => events.push({ type, ...e.detail }));
  let t = 0;
  let last = null;
  for (const lm of frames) { t += 33; last = g.process({ landmarks: lm, t, aspect: 4 / 3 }); }
  return { events, last, g };
}

test('pinch produces exactly one down and one up, debounced', () => {
  const frames = [...Array(10).fill(hand()), ...Array(10).fill(hand({ pinch: true })), ...Array(10).fill(hand())];
  const { events } = run(frames);
  assert.deepEqual(events.filter((e) => e.type === 'down' || e.type === 'up').map((e) => e.type), ['down', 'up']);
});

test('a single noisy pinch frame is ignored', () => {
  const frames = [...Array(10).fill(hand()), hand({ pinch: true }), ...Array(10).fill(hand())];
  assert.equal(run(frames).events.filter((e) => e.type === 'down').length, 0);
});

test('holding victory still fires undo; moving the hand suppresses it', () => {
  const still = run(Array(30).fill(hand({ fingers: { ring: 'curl', pinky: 'curl' } })));
  assert.equal(still.events.filter((e) => e.type === 'command' && e.name === 'undo').length, 1);
  const moving = run(Array.from({ length: 30 }, (_, k) => hand({ fingers: { ring: 'curl', pinky: 'curl' }, dx: (k % 2) * 0.04 })));
  assert.equal(moving.events.filter((e) => e.type === 'command' && e.name === 'undo').length, 0);
});

test('thumbs-up fires analyse, three fingers open the menu, fist grabs', () => {
  const curled = { index: 'curl', middle: 'curl', ring: 'curl', pinky: 'curl' };
  const names = (frames) => run(frames).events.filter((e) => e.type === 'command').map((e) => e.name);
  assert.deepEqual(names(Array(40).fill(hand({ fingers: curled, thumb: 'up' }))), ['analyze']);
  assert.deepEqual(names(Array(30).fill(hand({ fingers: { pinky: 'curl' } }))), ['menu']);
  assert.deepEqual(names([...Array(15).fill(hand({ fingers: curled, thumb: 'tucked' })), ...Array(6).fill(hand())]), ['grab-start', 'grab-end']);
});

test('the open palm (rest pose) never triggers a command', () => {
  assert.equal(run(Array(120).fill(hand())).events.filter((e) => e.type === 'command').length, 0);
});

test('losing the hand mid-pinch cancels the drag', () => {
  const frames = [...Array(5).fill(hand()), ...Array(6).fill(hand({ pinch: true })), ...Array(12).fill(null)];
  const { events } = run(frames);
  assert.ok(events.some((e) => e.type === 'cancel'));
  assert.ok(events.some((e) => e.type === 'lost'));
});

test('reach box sets the control-display gain to 1/reach', () => {
  // Moving the hand by 0.3 of the camera width with reach 0.6 crosses half the screen.
  const left = run(Array(20).fill(hand({ dx: 0.15 }))).last.x;
  const right = run(Array(20).fill(hand({ dx: -0.15 }))).last.x;
  assert.ok(Math.abs(right - left - 800) < 30, `span ${right - left}`);
});

test('One-Euro filter removes jitter but follows movement', () => {
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 10; };
  const f = new OneEuroFilter({ minCutoff: 1.2, beta: 0.012 });
  const out = [];
  for (let k = 0; k < 300; k++) out.push(f.filter(500 + noise(), k / 30));
  const tail = out.slice(60);
  const mean = tail.reduce((s, v) => s + v, 0) / tail.length;
  const sd = Math.sqrt(tail.reduce((s, v) => s + (v - mean) ** 2, 0) / tail.length);
  const rawSd = 10 / Math.sqrt(12); // uniform noise of +-5 px
  assert.ok(sd < rawSd * 0.5, `filtered sd ${sd.toFixed(2)} vs raw ${rawSd.toFixed(2)}`);
  const g = new OneEuroFilter({ minCutoff: 1.2, beta: 0.012 });
  let y = 0;
  for (let k = 0; k < 30; k++) y = g.filter(k * 40, k / 30);
  assert.ok(29 * 40 - y < 60, `lag ${29 * 40 - y}px at 1200 px/s`);
});

test('voice transcripts map to commands', () => {
  const kinds = (s) => parseVoice(s).map((c) => `${c.type}:${c.value}`);
  assert.deepEqual(kinds('Oxygen please'), ['element:O']);
  assert.deepEqual(kinds('make it a double bond'), ['bond:2']);
  assert.deepEqual(kinds('add a benzene'), ['ring:benzene']);
  assert.ok(kinds('please analyse this molecule').includes('command:analyze'));
  assert.ok(kinds('undo that').includes('command:undo'));
  assert.deepEqual(kinds('hello there'), []);
});
