// "AI Chemist" panel: calls the server-side Groq agent, streams its trace
// (tool calls, timings) so the reasoning stays transparent, renders the
// structured report, lets the user load suggested analogues back onto the
// canvas and ask follow-up questions. LLM text is only inserted as text nodes.

import { parseSmiles } from '../chem/index.js';
import { settings } from './settings.js';
import { toast, earcon, speak } from './feedback.js';
import { logger } from './logger.js';
import { el } from './properties.js';

const $ = (id) => document.getElementById(id);

const TOOL_LABELS = {
  compute_descriptors: 'Computing descriptors',
  pubchem_lookup: 'Identifying in PubChem',
  find_similar_compounds: 'Searching similar compounds',
  check_structural_alerts: 'Screening structural alerts',
  assess_drug_likeness: 'Assessing drug-likeness',
  get_safety_data: 'Fetching GHS safety data',
};

async function readEventStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}

/** Minimal, safe Markdown: paragraphs, bullet lists, **bold**, `code`. */
function markdown(text) {
  const frag = document.createDocumentFragment();
  const inline = (line, parent) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const p of parts) {
      if (p.startsWith('**') && p.endsWith('**') && p.length > 4) parent.append(el('b', { text: p.slice(2, -2) }));
      else if (p.startsWith('`') && p.endsWith('`') && p.length > 2) parent.append(el('code', { text: p.slice(1, -1) }));
      else if (p) parent.append(document.createTextNode(p));
    }
  };
  let list = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const bullet = /^([-*•]|\d+\.)\s+/.exec(line);
    if (bullet) {
      if (!list) { list = el('ul'); frag.append(list); }
      const li = el('li');
      inline(line.slice(bullet[0].length), li);
      list.append(li);
    } else {
      list = null;
      const p = el('p');
      inline(line.replace(/^#+\s*/, ''), p);
      frag.append(p);
    }
  }
  return frag;
}

export class AgentPanel extends EventTarget {
  constructor(editor) {
    super();
    this.editor = editor;
    this.busy = false;
    this.report = null;
    this.history = [];
    this.health = null;
    this.reportSmiles = null;
    $('btn-analyze').addEventListener('click', () => this.analyze('button'));
    $('agent-focus').value = settings.get('focus');
    $('agent-focus').addEventListener('change', (e) => settings.set('focus', e.target.value));
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('chat-input').value.trim();
      if (q) this.ask(q);
    });
    settings.addEventListener('change', (e) => { if (e.detail.key === 'groqKey' || e.detail.key === 'model') this.updateNote(); });
    this.refreshHealth();
  }

  async refreshHealth() {
    try { this.health = await (await fetch('/api/health')).json(); } catch { this.health = null; }
    this.updateNote();
  }

  get hasKey() { return Boolean(settings.get('groqKey') || this.health?.groqConfigured); }

  get model() { return settings.get('model') || this.health?.model || 'openai/gpt-oss-120b'; }

  updateNote() {
    $('agent-note').textContent = !this.health
      ? 'Server not reachable: start it with "npm start".'
      : this.hasKey
        ? `Agent: ${this.model} on Groq · tools: local engine + PubChem`
        : 'Offline mode: no Groq API key, so deterministic tools run without the LLM. Add a key in Settings for the full agent.';
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (settings.get('groqKey')) h['x-groq-key'] = settings.get('groqKey');
    return h;
  }

  selectTab() { document.querySelector('[data-tab="agent"]').click(); }

  traceItem(cls, icon, title, summary = '', time = '') {
    const li = el('li', { class: cls }, el('span', { class: 'ic', text: icon }),
      el('div', {}, el('b', { text: title }), summary ? el('span', { class: 'sum', text: summary }) : null),
      el('span', { class: 't', text: time }));
    $('agent-trace').append(li);
    li.scrollIntoView({ block: 'nearest' });
    return li;
  }

  async analyze(source = 'button') {
    const res = this.editor.analysis;
    if (this.busy) return;
    if (res.empty) { toast('Build a molecule first', { error: true }); earcon('error'); return; }
    if (res.problems.length) { toast('Fix the highlighted valence errors first', { error: true }); earcon('error'); return; }
    this.selectTab();
    this.busy = true;
    this.history = [];
    this.report = null;
    this.reportSmiles = res.smiles;
    $('btn-analyze').disabled = true;
    $('trace-wrap').hidden = false;
    $('trace-wrap').open = true;
    $('trace-summary').textContent = 'Agent trace (live)';
    $('agent-trace').replaceChildren();
    $('agent-report').replaceChildren();
    $('chat-log').replaceChildren();
    $('chat').hidden = true;
    earcon('start');
    logger.log('agent-request', { source, smiles: res.smiles });
    this.dispatchEvent(new Event('start'));
    const status = this.traceItem('pending', '•', 'Starting ChemAgent…');
    const calls = new Map();
    const t0 = performance.now();
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ smiles: res.smiles, mode: 'analyze', focus: settings.get('focus'), model: this.model }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
      await readEventStream(response, (event, data) => {
        switch (event) {
          case 'status':
            status.querySelector('b').textContent = data.message;
            break;
          case 'thought':
            this.traceItem('thought', '💭', 'Reasoning', data.text);
            break;
          case 'tool_call':
            calls.set(data.id, this.traceItem('pending', '🔧', TOOL_LABELS[data.name] ?? data.name, `${data.name}(${Object.values(data.args ?? {}).join(', ').slice(0, 60)})`));
            break;
          case 'tool_result': {
            const li = calls.get(data.id);
            if (!li) break;
            li.className = data.ok ? '' : 'error';
            li.querySelector('.ic').textContent = data.ok ? '✓' : '!';
            li.querySelector('.sum').textContent = data.summary;
            li.querySelector('.t').textContent = `${data.ms} ms`;
            break;
          }
          case 'report':
            this.report = data.report;
            this.renderReport(data.report, data.source);
            break;
          case 'error':
            this.traceItem('error', '!', 'Agent error', data.message);
            earcon('error');
            break;
          case 'done': {
            status.remove();
            const u = data.usage ?? {};
            const tokens = u.prompt_tokens ? ` · ${u.prompt_tokens + u.completion_tokens} tokens` : '';
            this.traceItem('', '⏱', `Done in ${(data.ms / 1000).toFixed(1)} s`, `${u.llm_calls ?? 0} LLM calls · ${u.tool_calls ?? 0} tool calls${tokens}`);
            $('trace-summary').textContent = `How this answer was produced · ${u.tool_calls ?? 0} tool calls · ${(data.ms / 1000).toFixed(1)} s`;
            if (this.report) $('trace-wrap').open = false;
            logger.log('agent-done', { ms: data.ms, client_ms: Math.round(performance.now() - t0), usage: u, model: data.model });
            break;
          }
          default:
            break;
        }
      });
    } catch (err) {
      status.remove();
      this.traceItem('error', '!', 'Request failed', err.message);
      toast(err.message, { error: true });
      earcon('error');
      logger.log('agent-error', { message: err.message });
    } finally {
      this.busy = false;
      $('btn-analyze').disabled = false;
      this.dispatchEvent(new Event('end'));
    }
  }

  renderReport(r, source) {
    earcon('success');
    const verdictClass = { 'Drug-like': 'ok', Borderline: 'warn', 'Not drug-like': 'bad' }[r.drug_likeness.verdict] ?? '';
    const safetyClass = { low: 'ok', moderate: 'warn', high: 'bad' }[r.safety.level] ?? '';
    const head = el('div', { class: 'report-head' },
      el('h3', { text: r.name }),
      r.iupac_name ? el('div', { class: 'iupac', text: r.iupac_name }) : null,
      el('div', { class: 'badges' },
        el('span', { class: `badge ${r.is_known_compound ? 'ok' : 'warn'}`, text: r.is_known_compound ? `Known · CID ${r.pubchem_cid ?? '?'}` : 'Not in PubChem' }),
        r.compound_class ? el('span', { class: 'badge', text: r.compound_class }) : null,
        el('span', { class: `badge ${verdictClass}`, text: r.drug_likeness.verdict }),
        el('span', { class: `badge ${safetyClass}`, text: `Hazard: ${r.safety.level}` }),
        el('span', { class: 'badge', text: source === 'offline' ? 'Tools only (no LLM)' : `Confidence: ${r.confidence}` })));

    const section = (title, ...body) => el('section', {}, el('h4', { text: title }), ...body);
    const list = (items) => el('ul', {}, ...items.map((t) => el('li', { text: t })));
    const parts = [head];
    if (r.summary) parts.push(section('Summary', el('p', { text: r.summary })));
    if (r.key_characteristics?.length) parts.push(section('Key characteristics', list(r.key_characteristics)));
    if (r.physicochemical_interpretation) parts.push(section('Physicochemical profile', el('p', { text: r.physicochemical_interpretation })));
    parts.push(section('Drug-likeness', el('p', { text: `${r.drug_likeness.verdict}. ${r.drug_likeness.explanation}` })));
    if (r.biological_activity) parts.push(section('Biological activity', el('p', { text: r.biological_activity })));
    if (r.applications?.length) parts.push(section('Applications', list(r.applications)));
    if (r.safety.notes?.length) parts.push(section('Safety', list(r.safety.notes)));
    if (r.synthesis_hint) parts.push(section('Synthesis idea (conceptual)', el('p', { text: r.synthesis_hint })));
    if (r.similar_compounds?.length) {
      parts.push(section('Similar known compounds', list(r.similar_compounds.map((c) => `${c.title} (CID ${c.cid}, ${c.formula})`))));
    }
    if (r.suggested_modifications?.length) {
      parts.push(section('Analogues to explore', ...r.suggested_modifications.map((m) => {
        const sign = (v) => (v > 0 ? `+${v}` : `${v}`);
        const btn = el('button', { type: 'button', 'data-dwell': '', text: 'Load on canvas' });
        btn.addEventListener('click', () => this.loadAnalog(m));
        return el('div', { class: 'analog' },
          el('b', { text: m.change || 'Analogue' }),
          el('code', { text: m.smiles }),
          el('div', { class: 'deltas' },
            el('span', { text: `ΔMW ${sign(m.delta.mw)}` }), el('span', { text: `ΔlogP ${sign(m.delta.logp)}` }),
            el('span', { text: `ΔTPSA ${sign(m.delta.tpsa)}` }), el('span', { text: m.lipinski_pass ? 'Ro5 ✓' : 'Ro5 ✗' })),
          m.rationale ? el('p', { class: 'small', text: m.rationale }) : null,
          btn);
      })));
    }
    if (r.caveats) parts.push(section('Caveats', el('p', { class: 'small muted', text: r.caveats })));

    const read = el('button', { type: 'button', 'data-dwell': '', text: '🔊 Read aloud' });
    read.addEventListener('click', () => this.readAloud());
    const copy = el('button', { type: 'button', 'data-dwell': '', text: 'Copy report (JSON)' });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); toast('Report copied'); } catch { toast('Clipboard unavailable', { error: true }); }
    });
    parts.push(el('div', { class: 'report-actions' }, read, copy));
    $('agent-report').replaceChildren(...parts);
    $('agent-report').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('chat').hidden = !this.hasKey;
    if (settings.get('speak')) this.readAloud();
  }

  readAloud() {
    const r = this.report;
    if (!r) { toast('No report yet'); return; }
    speak(`${r.name}. ${r.summary} Drug-likeness: ${r.drug_likeness.verdict}.`);
  }

  loadAnalog(m) {
    try {
      this.editor.loadMolecule(parseSmiles(m.smiles), 'load-analog', { smiles: m.smiles });
      toast(`Loaded analogue: ${m.change || m.smiles}`);
      earcon('place');
    } catch (err) {
      toast(`Cannot load analogue: ${err.message}`, { error: true });
    }
  }

  async ask(question) {
    if (this.busy) return;
    const smiles = this.editor.analysis.smiles || this.reportSmiles;
    if (!smiles) return;
    this.busy = true;
    $('chat-input').value = '';
    $('chat-log').append(el('div', { class: 'bubble user', text: question }));
    const pending = el('div', { class: 'bubble bot', text: 'Thinking…' });
    $('chat-log').append(pending);
    logger.log('agent-question', { question });
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          smiles, mode: 'chat', question, history: this.history, focus: settings.get('focus'), model: this.model,
          reportContext: this.report ? `${this.report.name}: ${this.report.summary}` : undefined,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
      let answer = '';
      await readEventStream(response, (event, data) => {
        if (event === 'tool_call') pending.textContent = `Using ${TOOL_LABELS[data.name] ?? data.name}…`;
        if (event === 'answer') answer = data.text;
        if (event === 'error') throw new Error(data.message);
      });
      pending.replaceChildren(markdown(answer));
      this.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    } catch (err) {
      pending.textContent = `Error: ${err.message}`;
    } finally {
      this.busy = false;
      pending.scrollIntoView({ block: 'nearest' });
    }
  }
}
