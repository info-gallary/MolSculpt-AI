// Integration tests for the HTTP server and the agent loop. A scripted mock
// stands in for the Groq API so the ReAct cycle (tool calls -> results ->
// JSON report) is exercised without network access or an API key.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const scripted = [];
const received = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received.push(JSON.parse(body || '{}'));
    const next = scripted.shift() ?? { role: 'assistant', content: '{}' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: next }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
});

let base;
let server;
before(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.GROQ_API_KEY = 'test_key_0123456789abcdef';
  ({ server } = await import('../server/server.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.close(); });

async function sse(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((chunk) => {
    const event = /event: (.*)/.exec(chunk)?.[1];
    const data = /data: (.*)/.exec(chunk)?.[1];
    return { event, data: data ? JSON.parse(data) : null };
  });
}

test('health and descriptors endpoints', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.ok, true);
  assert.equal(h.groqConfigured, true);
  const d = await (await fetch(`${base}/api/descriptors`, { method: 'POST', body: JSON.stringify({ smiles: 'CCO' }) })).json();
  assert.equal(d.formula, 'C2H6O');
});

test('static files are served and path traversal is blocked', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /MolSculpt/);
  const evil = await fetch(`${base}/..%2F..%2Fpackage.json`);
  assert.ok([403, 404].includes(evil.status));
});

test('invalid structures are rejected before reaching the LLM', async () => {
  const res = await fetch(`${base}/api/agent`, { method: 'POST', body: JSON.stringify({ smiles: 'C1CC' }) });
  assert.equal(res.status, 400);
});

test('agent runs tools, then returns a validated JSON report', async () => {
  received.length = 0;
  scripted.push(
    {
      role: 'assistant',
      content: 'I will compute descriptors and check drug-likeness.',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'compute_descriptors', arguments: '{"smiles":"CC(=O)Nc1ccc(O)cc1"}' } },
        { id: 'c2', type: 'function', function: { name: 'assess_drug_likeness', arguments: '{"smiles":"CC(=O)Nc1ccc(O)cc1"}' } },
      ],
    },
    {
      role: 'assistant',
      content: JSON.stringify({
        name: 'Paracetamol', iupac_name: 'N-(4-hydroxyphenyl)acetamide', is_known_compound: true, pubchem_cid: 1983,
        compound_class: 'Anilide; analgesic', summary: 'A common analgesic.', key_characteristics: ['Phenol', 'Amide'],
        physicochemical_interpretation: 'Balanced polarity.', drug_likeness: { verdict: 'Drug-like', explanation: 'No violations.' },
        biological_activity: 'COX inhibition (central).', applications: ['Pain relief'], safety: { level: 'moderate', notes: ['Hepatotoxic in overdose'] },
        synthesis_hint: 'Acetylation of 4-aminophenol.',
        suggested_modifications: [
          { smiles: 'CC(=O)Nc1ccc(OC)cc1', change: 'O-methylation', rationale: 'Removes phenol' },
          { smiles: 'C1CC', change: 'broken', rationale: 'invalid SMILES must be dropped' },
          { smiles: 'CC(=O)Nc1ccc(O)cc1', change: 'identical', rationale: 'same molecule must be dropped' },
        ],
        confidence: 'high', caveats: 'None.',
      }),
    },
  );
  const events = await sse('/api/agent', { smiles: 'CC(=O)Nc1ccc(O)cc1', mode: 'analyze' });
  const names = events.map((e) => e.event);
  assert.deepEqual(names.filter((n) => n === 'tool_call').length, 2);
  assert.deepEqual(names.filter((n) => n === 'tool_result').length, 2);
  assert.ok(events.filter((e) => e.event === 'tool_result').every((e) => e.data.ok));
  const report = events.find((e) => e.event === 'report').data.report;
  assert.equal(report.name, 'Paracetamol');
  assert.equal(report.suggested_modifications.length, 1);
  assert.equal(report.suggested_modifications[0].formula, 'C9H11NO2');
  assert.equal(report.suggested_modifications[0].delta.hbd, -1);
  const done = events.find((e) => e.event === 'done').data;
  assert.equal(done.usage.llm_calls, 2);
  assert.equal(done.usage.tool_calls, 2);
  // The second LLM call must carry the tool results back to the model.
  const toolMsgs = received[1].messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.match(toolMsgs[0].content, /C8H9NO2/);
  assert.ok(received[0].tools.some((t) => t.function.name === 'pubchem_lookup'));
});

test('chat mode streams a Markdown answer', async () => {
  scripted.push({ role: 'assistant', content: 'It is **moderately polar**.' });
  const events = await sse('/api/agent', { smiles: 'CCO', mode: 'chat', question: 'Is it polar?' });
  assert.equal(events.find((e) => e.event === 'answer').data.text, 'It is **moderately polar**.');
});
