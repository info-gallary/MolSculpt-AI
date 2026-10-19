// Built-in user-study instrumentation: timed construction tasks whose
// completion is detected automatically (graph signature of the canvas equals
// the target), per-trial interaction metrics from the logger, SUS and raw
// NASA-TLX questionnaires, and CSV / JSON export for analysis.

import { parseSmiles, perceive, graphSignature } from '../chem/index.js';
import { layoutMolecule } from '../chem/layout.js';
import { drawThumbnail } from './renderer.js';
import { logger } from './logger.js';
import { toast, earcon } from './feedback.js';
import { el } from './properties.js';

const $ = (id) => document.getElementById(id);
const STORE = 'molsculpt.study.v1';

export const TASKS = [
  { id: 'T1', name: 'Ethanol', smiles: 'CCO', level: 'chain, 3 atoms' },
  { id: 'T2', name: 'Acetone', smiles: 'CC(C)=O', level: 'branch + double bond' },
  { id: 'T3', name: 'Benzene', smiles: 'c1ccccc1', level: 'aromatic ring' },
  { id: 'T4', name: 'Acetic acid', smiles: 'CC(=O)O', level: 'functional group' },
  { id: 'T5', name: 'Paracetamol', smiles: 'CC(=O)Nc1ccc(O)cc1', level: 'drug, 11 heavy atoms' },
];

const SUS_ITEMS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
];

const TLX_ITEMS = ['Mental demand', 'Physical demand', 'Temporal demand', 'Performance (0 = perfect)', 'Effort', 'Frustration'];

export function susScore(answers) {
  // Brooke (1996): odd items score (x-1), even items (5-x); sum × 2.5.
  return answers.reduce((s, x, i) => s + (i % 2 === 0 ? x - 1 : 5 - x), 0) * 2.5;
}

function signatureOf(smiles) {
  return graphSignature(perceive(parseSmiles(smiles)));
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export class Study {
  constructor(editor, openDialog, closeDialog) {
    this.editor = editor;
    this.open = openDialog;
    this.close = closeDialog;
    this.data = { trials: [], questionnaires: [], events: [] };
    try { this.data = { ...this.data, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { /* fresh */ }
    this.current = null;
    this.timer = null;
    this.targets = new Map(TASKS.map((t) => [t.id, signatureOf(t.smiles)]));

    editor.addEventListener('change', () => this.check());
    logger.addEventListener('event', (e) => { if (this.current) this.current.events.push(e.detail); });

    $('st-sus').addEventListener('click', () => this.showSus());
    $('st-tlx').addEventListener('click', () => this.showTlx());
    $('st-export-csv').addEventListener('click', () => this.exportCsv());
    $('st-export-json').addEventListener('click', () => download(`molsculpt-study-${Date.now()}.json`, JSON.stringify(this.data, null, 2), 'application/json'));
    $('st-reset').addEventListener('click', () => {
      if (!confirm('Delete all stored study data from this browser?')) return;
      this.data = { trials: [], questionnaires: [], events: [] };
      this.save();
      this.renderTasks();
    });
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { toast('Browser storage unavailable: export your data before closing', { error: true }); }
  }

  show() {
    this.renderTasks();
    $('st-questionnaire').replaceChildren();
    this.open('dlg-study');
  }

  participant() { return $('st-participant').value.trim() || 'anonymous'; }

  condition() { return $('st-condition').value; }

  renderTasks() {
    const done = (id) => this.data.trials.filter((t) => t.task === id && t.participant === this.participant() && t.condition === this.condition());
    $('st-tasks').replaceChildren(...TASKS.map((t) => {
      const prev = done(t.id);
      const last = prev[prev.length - 1];
      const start = el('button', { type: 'button', 'data-dwell': '', text: prev.length ? 'Repeat' : 'Start' });
      start.addEventListener('click', () => this.start(t));
      return el('div', { class: 'task' },
        el('span', { class: 'id', text: t.id }),
        el('div', {}, el('b', { text: t.name }), el('div', { class: 'small muted', text: `${t.level} · ${t.smiles}` })),
        el('span', { class: 'res', text: last ? `${(last.time_ms / 1000).toFixed(1)} s${last.completed ? '' : ' (gave up)'}` : '' }),
        start);
    }));
    const n = this.data.trials.length;
    $('st-summary').textContent = `${n} trial(s) and ${this.data.questionnaires.length} questionnaire(s) stored in this browser.`;
  }

  start(task) {
    this.close('dlg-study');
    this.editor.mol.clear();
    this.editor.undoStack = [];
    this.editor.redoStack = [];
    this.editor.changed('study-reset');
    this.editor.fit();
    this.current = { task, startedAt: performance.now(), events: [] };
    logger.log('trial-start', { task: task.id, participant: this.participant(), condition: this.condition() });
    this.showBanner(task);
    earcon('start');
  }

  showBanner(task) {
    const banner = $('study-banner');
    const canvas = el('canvas', { width: '120', height: '80' });
    const time = el('span', { class: 'timer', text: '0.0 s' });
    const giveUp = el('button', { type: 'button', 'data-dwell': '', text: 'Give up' });
    giveUp.addEventListener('click', () => this.finish(false));
    banner.replaceChildren(
      el('div', {}, el('b', { text: `${task.id}: build ${task.name}` }), el('div', { class: 'small muted', text: 'Completion is detected automatically' })),
      canvas, time, giveUp);
    banner.hidden = false;
    const mol = layoutMolecule(parseSmiles(task.smiles), { bondLength: 50 });
    const atoms = [...mol.atoms.values()];
    const index = new Map(atoms.map((a, i) => [a.id, i]));
    requestAnimationFrame(() => drawThumbnail(canvas, atoms, [...mol.bonds.values()].map((b) => ({ a: index.get(b.a), b: index.get(b.b), order: b.order }))));
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.current) time.textContent = `${((performance.now() - this.current.startedAt) / 1000).toFixed(1)} s`;
    }, 100);
  }

  check() {
    if (!this.current || this.editor.analysis.empty) return;
    if (this.editor.analysis.signature === this.targets.get(this.current.task.id)) this.finish(true);
  }

  finish(completed) {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    clearInterval(this.timer);
    $('study-banner').hidden = true;
    const ev = cur.events;
    const count = (pred) => ev.filter(pred).length;
    const edits = ['add-atom', 'grow-chain', 'add-bond', 'bond-order', 'change-element', 'add-ring', 'erase', 'charge', 'move-atom'];
    const modalities = [...new Set(ev.map((e) => e.modality))];
    const trial = {
      participant: this.participant(),
      condition: this.condition(),
      task: cur.task.id,
      target: cur.task.name,
      completed,
      time_ms: Math.round(performance.now() - cur.startedAt),
      edit_actions: count((e) => edits.includes(e.type)),
      undos: count((e) => e.type === 'undo'),
      erases: count((e) => e.type === 'erase'),
      warnings: count((e) => e.type === 'warning'),
      pinches: count((e) => e.type === 'pinch-down'),
      dwell_clicks: count((e) => e.type === 'dwell-click'),
      gesture_commands: count((e) => e.type === 'gesture-command'),
      menu_selections: count((e) => e.type === 'menu-select'),
      cancelled_drags: count((e) => e.type === 'drag-cancelled'),
      hand_lost: count((e) => e.type === 'hand-lost'),
      modalities: modalities.join('+'),
      finished_at: new Date().toISOString(),
    };
    this.data.trials.push(trial);
    this.data.events.push({ task: trial.task, participant: trial.participant, condition: trial.condition, events: ev });
    this.save();
    logger.log('trial-end', { task: trial.task, completed, time_ms: trial.time_ms });
    if (completed) { earcon('success'); toast(`${cur.task.name} completed in ${(trial.time_ms / 1000).toFixed(1)} s`, { ms: 3000 }); }
    else toast('Trial recorded as not completed');
    this.show();
  }

  showSus() {
    const rows = SUS_ITEMS.flatMap((q, i) => [
      el('span', { text: `${i + 1}. ${q}` }),
      ...[1, 2, 3, 4, 5].map((v) => el('label', {}, el('input', { type: 'radio', name: `sus${i}`, value: String(v), 'aria-label': `${v}` }))),
    ]);
    const head = [el('span'), ...['1', '2', '3', '4', '5'].map((s) => el('span', { class: 'scale', text: s }))];
    const save = el('button', { type: 'button', class: 'primary', text: 'Save SUS' });
    save.addEventListener('click', () => {
      const answers = SUS_ITEMS.map((_, i) => Number(document.querySelector(`input[name="sus${i}"]:checked`)?.value));
      if (answers.some((a) => !a)) { toast('Please answer all 10 items', { error: true }); return; }
      const score = susScore(answers);
      this.data.questionnaires.push({ type: 'SUS', participant: this.participant(), condition: this.condition(), answers, score, at: new Date().toISOString() });
      this.save();
      toast(`SUS score ${score.toFixed(1)}`);
      this.show();
    });
    $('st-questionnaire').replaceChildren(
      el('p', { class: 'small muted', text: '1 = strongly disagree … 5 = strongly agree' }),
      el('div', { class: 'likert' }, ...head, ...rows), save);
  }

  showTlx() {
    const inputs = TLX_ITEMS.map(() => el('input', { type: 'range', min: '0', max: '100', step: '5', value: '50' }));
    const outs = inputs.map((inp) => {
      const o = el('output', { text: '50' });
      inp.addEventListener('input', () => { o.textContent = inp.value; });
      return o;
    });
    const save = el('button', { type: 'button', class: 'primary', text: 'Save NASA-TLX' });
    save.addEventListener('click', () => {
      const values = inputs.map((i) => Number(i.value));
      const raw = values.reduce((s, v) => s + v, 0) / values.length;
      this.data.questionnaires.push({ type: 'NASA-TLX-raw', participant: this.participant(), condition: this.condition(), items: Object.fromEntries(TLX_ITEMS.map((k, i) => [k, values[i]])), score: raw, at: new Date().toISOString() });
      this.save();
      toast(`Raw TLX ${raw.toFixed(1)}`);
      this.show();
    });
    $('st-questionnaire').replaceChildren(el('div', { class: 'tlx' }, ...TLX_ITEMS.flatMap((k, i) => [el('span', { text: k }), inputs[i], outs[i]])), save);
  }

  exportCsv() {
    const t = this.data.trials;
    if (!t.length) { toast('No trials recorded yet'); return; }
    const cols = Object.keys(t[0]);
    const lines = [cols.join(','), ...t.map((r) => cols.map((c) => csvCell(r[c])).join(','))];
    const q = this.data.questionnaires.map((x) => [x.type, x.participant, x.condition, x.score, x.at].map(csvCell).join(','));
    download(`molsculpt-trials-${Date.now()}.csv`, `${lines.join('\n')}\n`, 'text/csv');
    if (q.length) download(`molsculpt-questionnaires-${Date.now()}.csv`, `type,participant,condition,score,at\n${q.join('\n')}\n`, 'text/csv');
  }
}
