// Measures per-tool latency of the agent's tool pipeline (no LLM needed):
// the deterministic offline run executes the same tools the Groq agent calls.
// Usage: node evaluation/agent_latency.mjs [out.json]   (needs internet for PubChem)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOffline } from '../server/agent.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'results', 'agent_tool_latency.json');

const MOLECULES = [
  ['Aspirin', 'CC(=O)Oc1ccccc1C(=O)O'],
  ['Paracetamol', 'CC(=O)Nc1ccc(O)cc1'],
  ['Caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'],
  ['Ibuprofen', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O'],
  ['Dopamine', 'NCCc1ccc(O)c(O)c1'],
  ['Benzocaine', 'CCOC(=O)c1ccc(N)cc1'],
  ['Nicotine', 'CN1CCCC1c1cccnc1'],
  ['Metformin', 'CN(C)C(=N)NC(=N)N'],
  // Hypothetical structures that are unlikely to be registered (exercise the similarity path).
  ['Novel analogue A', 'CC(=O)Oc1ccc(C#CCCCN2CCOCC2)cc1C(=O)OCC(F)(F)F'],
  ['Novel analogue B', 'O=C(Nc1ccc(OC(F)(F)F)cc1)c1cc2cc(Cl)ccc2[nH]1'],
];

const rows = [];
for (const [name, smiles] of MOLECULES) {
  const tools = [];
  let total = 0;
  let report = null;
  await runOffline({
    smiles,
    emit: (event, data) => {
      if (event === 'tool_result') tools.push({ tool: data.name, ms: data.ms, ok: data.ok, summary: data.summary });
      if (event === 'report') report = data.report;
      if (event === 'done') total = data.ms;
    },
  });
  rows.push({ name, smiles, total_ms: total, known: report?.is_known_compound, identified_as: report?.name, tools });
  console.log(`${name.padEnd(18)} ${String(total).padStart(6)} ms  ${report?.name}  ${tools.map((t) => `${t.tool}:${t.ms}`).join(' ')}`);
}

const byTool = {};
for (const r of rows) for (const t of r.tools) (byTool[t.tool] ??= []).push(t.ms);
const stats = Object.fromEntries(Object.entries(byTool).map(([k, v]) => {
  const s = [...v].sort((a, b) => a - b);
  return [k, { n: v.length, mean_ms: Math.round(v.reduce((a, b) => a + b, 0) / v.length), median_ms: s[s.length >> 1], max_ms: s[s.length - 1] }];
}));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ measured_at: new Date().toISOString(), per_tool: stats, runs: rows }, null, 2));
console.log(JSON.stringify(stats, null, 2));
