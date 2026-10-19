// Gesture interpretation from 21 MediaPipe hand landmarks.
//   pointer : midpoint of thumb and index tips, mirrored, mapped from a
//             central "reach" box of the camera image to the whole screen
//             (control-display gain) and smoothed with the 1€ filter.
//   pinch   : thumb-index distance normalised by palm size, with hysteresis
//             and frame debouncing; down/up points are taken ~70 ms in the
//             past so closing the fingers does not drag the cursor.
//   poses   : victory (undo), thumbs-up (analyse), three fingers (element
//             menu) fire only after a hold with the hand kept still, which
//             avoids accidental "Midas touch" activation; a fist grabs/pans.
// Pure logic (no DOM) so it can be unit-tested with synthetic hands.

import { OneEuroFilter2D } from './one-euro.js';

export const HOLD_GESTURES = {
  victory: { command: 'undo', ms: 700, label: 'Undo', repeatMs: 900 },
  thumbs_up: { command: 'analyze', ms: 900, label: 'Analyse' },
  three: { command: 'menu', ms: 650, label: 'Element menu' },
};

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const EXTENDED = 1.5;
const CURLED = 1.3;
const STILL_PX_PER_S = 420;
const LOST_MS = 250;
const CLICK_LOOKBACK_MS = 70;

/** Classify a static hand pose from landmarks already mirrored to screen orientation. */
export function classifyPose(P) {
  const d = (a, b) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y);
  const scale = d(0, 9) || 1e-6;
  const ratio = (tip, mcp) => d(0, tip) / (d(0, mcp) || 1e-6);
  const r = { index: ratio(8, 5), middle: ratio(12, 9), ring: ratio(16, 13), pinky: ratio(20, 17) };
  const ext = (k) => r[k] > EXTENDED;
  const curl = (k) => r[k] < CURLED;
  const pinch = d(4, 8) / scale;
  const thumbOut = d(4, 5) / scale > 0.6;
  const thumbUp = P[4].y < P[3].y && P[3].y < P[2].y && (P[5].y - P[4].y) / scale > 0.45;

  let pose = 'none';
  if (ext('index') && ext('middle') && ext('ring') && ext('pinky') && thumbOut) pose = 'open_palm';
  else if (ext('index') && ext('middle') && ext('ring') && curl('pinky')) pose = 'three';
  else if (ext('index') && ext('middle') && curl('ring') && curl('pinky')) pose = 'victory';
  else if (curl('index') && curl('middle') && curl('ring') && curl('pinky')) pose = thumbUp ? 'thumbs_up' : 'fist';
  else if (ext('index') && curl('middle') && curl('ring')) pose = 'point';
  return { pose, ratios: r, pinch, scale, indexBent: r.index > 1.15 };
}

export class GestureInterpreter extends EventTarget {
  /**
   * @param {() => {reach:number, smoothing:number, pinch:number}} getConfig
   * @param {() => {w:number, h:number}} getViewport
   */
  constructor(getConfig, getViewport) {
    super();
    this.getConfig = getConfig;
    this.getViewport = getViewport;
    this.pointerFilter = new OneEuroFilter2D({ minCutoff: 1.2, beta: 0.012, dCutoff: 1 });
    this.palmFilter = new OneEuroFilter2D({ minCutoff: 1.0, beta: 0.01, dCutoff: 1 });
    this.reset();
  }

  reset() {
    this.present = false;
    this.lastSeen = 0;
    this.pinching = false;
    this.pinchVotes = 0;
    this.pose = 'none';
    this.candidate = 'none';
    this.candidateFrames = 0;
    this.poseSince = 0;
    this.holdStart = 0;
    this.lastFire = 0;
    this.fired = false;
    this.grabbing = false;
    this.history = [];
    this.pointerFilter.reset();
    this.palmFilter.reset();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  pointAt(t) {
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].t <= t) return { ...this.history[i] };
    return this.history.length ? { ...this.history[0] } : { x: 0, y: 0 };
  }

  /** Feed one tracker frame; returns the interpreted state for the HUD. */
  process({ landmarks, t, aspect = 4 / 3 }) {
    if (!landmarks) {
      if (this.present && t - this.lastSeen > LOST_MS) {
        this.present = false;
        if (this.pinching) { this.pinching = false; this.emit('cancel', {}); }
        if (this.grabbing) { this.grabbing = false; this.emit('command', { name: 'grab-end' }); }
        this.pose = 'none';
        this.emit('lost', {});
      }
      return { present: this.present };
    }
    this.lastSeen = t;
    if (!this.present) {
      this.present = true;
      this.pointerFilter.reset();
      this.palmFilter.reset();
      this.history = [];
      this.emit('found', {});
    }

    const cfg = this.getConfig();
    const vp = this.getViewport();
    // Mirror horizontally (selfie view) and make x and y isotropic.
    const P = landmarks.map((p) => ({ x: (1 - p.x) * aspect, y: p.y }));
    const info = classifyPose(P);

    // Pinch with hysteresis + 2-frame debounce; ignore "pinches" inside a fist.
    const onT = cfg.pinch ?? 0.3;
    const wantPinch = this.pinching ? info.pinch < onT + 0.14 : info.pinch < onT && info.indexBent;
    this.pinchVotes = wantPinch === this.pinching ? 0 : this.pinchVotes + 1;
    const pinchChanged = this.pinchVotes >= 2;

    // Pointer mapping (reach box -> viewport) and smoothing.
    const reach = cfg.reach ?? 0.6;
    const reachY = reach * 0.9;
    const map = (pt) => ({
      x: Math.min(1, Math.max(0, (pt.x / aspect - (0.5 - reach / 2)) / reach)) * vp.w,
      y: Math.min(1, Math.max(0, (pt.y - (0.5 - reachY / 2)) / reachY)) * vp.h,
    });
    const rawPointer = map({ x: (P[4].x + P[8].x) / 2, y: (P[4].y + P[8].y) / 2 });
    const rawPalm = map(P[9]);
    this.pointerFilter.minCutoff = cfg.smoothing ?? 1.2;
    const ts = t / 1000;
    const ptr = this.pointerFilter.filter(rawPointer.x, rawPointer.y, ts);
    const palm = this.palmFilter.filter(rawPalm.x, rawPalm.y, ts);
    const prev = this.history[this.history.length - 1];
    const speed = prev ? Math.hypot(ptr.x - prev.x, ptr.y - prev.y) / Math.max(0.001, (t - prev.t) / 1000) : 0;
    this.history.push({ t, x: ptr.x, y: ptr.y });
    while (this.history.length && t - this.history[0].t > 400) this.history.shift();

    if (pinchChanged) {
      this.pinchVotes = 0;
      this.pinching = !this.pinching;
      const p = this.pointAt(t - CLICK_LOOKBACK_MS);
      this.emit(this.pinching ? 'down' : 'up', p);
    }

    // Static poses (suspended while pinching).
    const raw = this.pinching ? 'pinch' : info.pose;
    if (raw === this.candidate) this.candidateFrames++;
    else { this.candidate = raw; this.candidateFrames = 1; }
    if (this.candidateFrames >= 3 && this.candidate !== this.pose) {
      this.pose = this.candidate;
      this.poseSince = t;
      this.holdStart = t;
      this.fired = false;
    }

    // Hold-to-fire with stillness gating.
    let hold = null;
    const g = HOLD_GESTURES[this.pose];
    if (g) {
      if (speed > STILL_PX_PER_S) this.holdStart = t;
      let due = Infinity;
      if (!this.fired) due = this.holdStart + g.ms;
      else if (g.repeatMs) due = Math.max(this.lastFire, this.holdStart) + g.repeatMs;
      const span = this.fired ? g.repeatMs : g.ms;
      const progress = Number.isFinite(due) ? Math.max(0, Math.min(1, 1 - (due - t) / span)) : 1;
      hold = { label: g.label, progress, done: this.fired && !g.repeatMs };
      if (t >= due) {
        this.fired = true;
        this.lastFire = t;
        this.emit('command', { name: g.command, pose: this.pose });
      }
    }

    // Fist = grab the canvas.
    if (this.pose === 'fist' && !this.grabbing && t - this.poseSince > 150) {
      this.grabbing = true;
      this.emit('command', { name: 'grab-start' });
    } else if (this.pose !== 'fist' && this.grabbing) {
      this.grabbing = false;
      this.emit('command', { name: 'grab-end' });
    }

    return {
      present: true,
      x: ptr.x,
      y: ptr.y,
      palm,
      speed,
      pinching: this.pinching,
      pose: this.pose,
      grabbing: this.grabbing,
      hold,
      metrics: { pinch: info.pinch, ratios: info.ratios },
      landmarks: P.map((p) => ({ x: p.x / aspect, y: p.y })),
      reach,
    };
  }
}
