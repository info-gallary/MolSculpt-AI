// Characterises the cursor filter on synthetic signals (30 Hz input):
// jitter = SD of output for a still hand with uniform +-5 px noise;
// lag = distance behind a target moving at constant speed (steady state).
// Usage: node evaluation/one_euro.mjs [out.json]

import { writeFileSync } from 'node:fs';
import { OneEuroFilter } from '../public/js/input/one-euro.js';

const out = process.argv[2] ?? 'evaluation/results/one_euro.json';
const FPS = 30;
const BETA = 0.012;

function jitter(minCutoff, beta = BETA) {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const f = new OneEuroFilter({ minCutoff, beta });
  const ys = [];
  for (let k = 0; k < 3000; k++) ys.push(f.filter(500 + (rnd() - 0.5) * 10, k / FPS));
  const tail = ys.slice(100);
  const m = tail.reduce((s, v) => s + v, 0) / tail.length;
  return Math.sqrt(tail.reduce((s, v) => s + (v - m) ** 2, 0) / tail.length);
}

function lag(minCutoff, speed, beta = BETA) {
  const f = new OneEuroFilter({ minCutoff, beta });
  let y = 0;
  for (let k = 0; k < 90; k++) y = f.filter(speed * (k / FPS), k / FPS);
  return speed * (89 / FPS) - y;
}

const raw = 10 / Math.sqrt(12);
const rows = [0.5, 1.2, 2.0, 4.0].map((mc) => ({
  min_cutoff_hz: mc,
  jitter_sd_px: +jitter(mc).toFixed(2),
  jitter_reduction_pct: +(100 * (1 - jitter(mc) / raw)).toFixed(1),
  lag_px_at_300px_s: +lag(mc, 300).toFixed(1),
  lag_px_at_1200px_s: +lag(mc, 1200).toFixed(1),
  lag_px_at_1200px_s_no_beta: +lag(mc, 1200, 0).toFixed(1),
}));
writeFileSync(out, JSON.stringify({ input_fps: FPS, beta: BETA, raw_jitter_sd_px: +raw.toFixed(2), rows }, null, 2));
console.table(rows);
