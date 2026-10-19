// Runs the MolSculpt chemistry engine over a benchmark set and writes the
// computed descriptors (plus per-molecule timing) for comparison with RDKit.
// Usage: node evaluation/compute_js.mjs [input.json] [out.json]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseSmiles, analyze } from '../public/js/chem/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] ?? join(here, 'benchmark.json');
const out = process.argv[3] ?? join(here, 'results', 'js_descriptors.json');
const bench = JSON.parse(readFileSync(input, 'utf8'));

const tryParse = (smiles) => {
  try { return parseSmiles(smiles); } catch { return null; }
};

// Warm-up so JIT compilation does not distort the first timings.
const warm = bench.slice(0, 60).map((m) => tryParse(m.smiles)).filter(Boolean);
for (let k = 0; k < 20; k++) for (const m of warm) analyze(m);

const REPEAT = bench.length > 200 ? 5 : 50;
const failures = [];
const rows = [];
for (const entry of bench) {
  const { name, smiles } = entry;
  let mol;
  try {
    mol = parseSmiles(smiles);
  } catch (err) {
    failures.push({ name, smiles, error: err.message });
    continue;
  }
  const t0 = performance.now();
  let res;
  for (let k = 0; k < REPEAT; k++) res = analyze(mol);
  const ms = (performance.now() - t0) / REPEAT;
  const d = res.descriptors;
  rows.push({
    ...entry,
    out_smiles: res.smiles,
    formula: d.formula,
    mw: d.molecularWeight,
    exact_mass: d.exactMass,
    heavy_atoms: d.heavyAtoms,
    hbd: d.hbd,
    hba: d.hba,
    tpsa: d.tpsa,
    logp: d.logP,
    mr: d.molarRefractivity,
    rotb: d.rotatableBonds,
    rings: d.rings,
    aromatic_rings: d.aromaticRings,
    fsp3: d.fractionCsp3,
    esol_logS: d.esolLogS,
    groups: res.groups.map((g) => g.name),
    alerts: res.alerts.map((a) => a.name),
    analyze_ms: ms,
  });
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(rows, null, 1));
if (failures.length) writeFileSync(out.replace(/\.json$/, '_failures.json'), JSON.stringify(failures, null, 1));
const times = rows.map((r) => r.analyze_ms).sort((a, b) => a - b);
const mean = times.reduce((s, t) => s + t, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)];
console.log(`${rows.length} analysed, ${failures.length} parse failures -> ${out}`);
console.log(`full analysis: mean ${mean.toFixed(3)} ms, median ${times[times.length >> 1].toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`);
