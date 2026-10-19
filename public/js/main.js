// MolSculpt bootstrap: wires the editor, renderer, panels and the three input
// modalities (pointer, hand gestures, voice) together.

import { Editor } from './ui/editor.js';
import { Renderer, atomColor } from './ui/renderer.js';
import { Hud, RadialMenu } from './ui/hud.js';
import { PropertiesPanel } from './ui/properties.js';
import { AgentPanel } from './ui/agent-panel.js';
import { Library, templateToMolecule } from './ui/library.js';
import { Study } from './ui/study.js';
import { settings } from './ui/settings.js';
import { toast, earcon } from './ui/feedback.js';
import { logger } from './ui/logger.js';
import { HandController } from './input/hand-controller.js';
import { VoiceControl } from './input/voice.js';
import { ELEMENTS, PALETTE } from './chem/elements.js';
import { parseSmiles } from './chem/index.js';
import { TEMPLATES } from './data/templates.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const stage = $('stage');

// ------------------------------------------------------------ dialogs
// Non-modal dialogs + our own backdrop keep the hand cursor overlay on top.
const backdrop = document.createElement('div');
backdrop.className = 'backdrop';
backdrop.hidden = true;
document.body.append(backdrop);

function openDialog(id) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $(id).show();
  backdrop.hidden = false;
  logger.log('dialog-open', { dialog: id });
}
function closeDialog(id) {
  $(id).close();
}
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('close', () => {
  if (!document.querySelector('dialog[open]')) backdrop.hidden = true;
}));
backdrop.addEventListener('click', () => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

// ------------------------------------------------------------ core
const editor = new Editor();
const renderer = new Renderer(canvas, editor);
const hud = new Hud($('overlay'), $('minimap-canvas'));
const menu = new RadialMenu();
const properties = new PropertiesPanel(editor);
const agent = new AgentPanel(editor);
const library = new Library(editor, openDialog, closeDialog);
const study = new Study(editor, openDialog, closeDialog);
const hand = new HandController({ editor, canvas, video: $('video'), hud, menu });
const voice = new VoiceControl();
window.molsculpt = { editor, renderer, agent, study, hand, settings, logger };

// ------------------------------------------------------------ theme
function applyTheme() {
  const t = settings.get('theme');
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  renderer.readTheme();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderer.readTheme());

// ------------------------------------------------------------ tool rail
const palette = $('palette');
for (const elSym of PALETTE) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.element = elSym;
  b.dataset.dwell = '';
  b.setAttribute('role', 'radio');
  b.title = `${ELEMENTS[elSym].name} (${elSym === 'Cl' ? 'L' : elSym === 'Br' ? 'R' : elSym})`;
  const sw = document.createElement('i');
  sw.className = 'swatch';
  sw.style.background = atomColor(elSym);
  b.append(sw, elSym);
  b.addEventListener('click', () => { editor.setElement(elSym); earcon('click'); });
  palette.append(b);
}
document.querySelectorAll('[data-bond]').forEach((b) => b.addEventListener('click', () => { editor.setBondOrder(Number(b.dataset.bond)); earcon('click'); }));
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { editor.setTool(b.dataset.tool); earcon('click'); }));
document.querySelectorAll('[data-ring]').forEach((b) => b.addEventListener('click', () => { editor.setRing(b.dataset.ring); earcon('click'); }));
$('btn-undo').addEventListener('click', () => runCommand('undo'));
$('btn-redo').addEventListener('click', () => runCommand('redo'));
$('btn-clear').addEventListener('click', () => runCommand('clear'));
$('btn-fit').addEventListener('click', () => runCommand('fit'));

const TOOL_TEXT = { draw: 'Draw', move: 'Move', erase: 'Erase', charge: 'Charge', ring: 'Ring' };
function syncState() {
  const drawing = editor.tool === 'draw';
  document.querySelectorAll('[data-element]').forEach((b) => b.setAttribute('aria-checked', String(drawing && b.dataset.element === editor.element)));
  document.querySelectorAll('[data-bond]').forEach((b) => b.setAttribute('aria-checked', String(drawing && Number(b.dataset.bond) === editor.bondOrder)));
  document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-checked', String(editor.tool === b.dataset.tool)));
  document.querySelectorAll('[data-ring]').forEach((b) => b.setAttribute('aria-checked', String(editor.tool === 'ring' && editor.ring === b.dataset.ring)));
  $('btn-undo').disabled = !editor.undoStack.length;
  $('btn-redo').disabled = !editor.redoStack.length;
  stage.className = `stage tool-${editor.tool}`;
  const detail = editor.tool === 'draw'
    ? `${ELEMENTS[editor.element].name}, ${['', 'single', 'double', 'triple'][editor.bondOrder]} bond`
    : editor.tool === 'ring' ? editor.ring : '';
  $('sb-tool').textContent = `Tool: ${TOOL_TEXT[editor.tool]}${detail ? ` · ${detail}` : ''}`;
}
editor.addEventListener('state', syncState);
editor.addEventListener('change', (e) => {
  syncState();
  const label = e.detail.label;
  if (['add-atom', 'grow-chain', 'add-ring', 'change-element'].includes(label)) earcon('place');
  else if (['add-bond', 'bond-order'].includes(label)) earcon('bond');
  else if (label === 'erase') earcon('erase');
});
editor.addEventListener('warn', (e) => { toast(e.detail.message, { error: true }); earcon('error'); });

// ------------------------------------------------------------ commands
function runCommand(name, source = 'ui') {
  switch (name) {
    case 'undo': if (editor.undo()) { earcon('undo'); if (source !== 'ui') toast('Undo'); } break;
    case 'redo': if (editor.redo()) earcon('undo'); break;
    case 'clear':
      if (!editor.mol.isEmpty) { editor.clear(); toast('Canvas cleared. Undo restores it'); }
      break;
    case 'fit': editor.fit(); break;
    case 'analyze': agent.analyze(source); break;
    case 'library': library.show(); break;
    case 'help': openDialog('dlg-help'); break;
    case 'read': agent.readAloud(); break;
    default: break;
  }
}

// ------------------------------------------------------------ pointer input
const local = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const usePointer = () => { editor.modality = 'mouse'; logger.modality = 'mouse'; };
const drawMenuOnly = () => { if (!hand.active) hud.draw(null, { menu }); };

canvas.addEventListener('pointerdown', (e) => {
  usePointer();
  if (menu.active) {
    const i = menu.indexAt(e.clientX, e.clientY);
    if (i >= 0) selectElement(menu.items[i].key, 'menu');
    menu.close();
    drawMenuOnly();
    return;
  }
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  editor.pointerDown(local(e));
});
canvas.addEventListener('pointermove', (e) => {
  if (menu.active) { menu.update(e.clientX, e.clientY); menu.progress = 0; drawMenuOnly(); return; }
  if (e.pointerType === 'mouse' && hand.state?.present && !editor.drag) return; // hand owns the hover
  usePointer();
  editor.pointerMove(local(e));
});
canvas.addEventListener('pointerup', (e) => { if (editor.drag) editor.pointerUp(local(e)); });
canvas.addEventListener('pointercancel', () => editor.pointerCancel());
canvas.addEventListener('pointerleave', () => { if (!editor.drag && !hand.state?.present) { editor.hover = null; editor.ghost = null; editor.render(); } });
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  usePointer();
  menu.open(e.clientX, e.clientY);
  logger.log('menu-open');
  drawMenuOnly();
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); editor.zoomAt(local(e), e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

function selectElement(elSym, how) {
  editor.setElement(elSym);
  toast(`${ELEMENTS[elSym].name} selected`);
  earcon('click');
  logger.log('element-selected', { element: elSym, how });
}

// ------------------------------------------------------------ keyboard
const KEY_ELEMENTS = { c: 'C', n: 'N', o: 'O', s: 'S', p: 'P', f: 'F', h: 'H', l: 'Cl', r: 'Br', i: 'I' };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); runCommand(e.shiftKey ? 'redo' : 'undo'); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); runCommand('redo'); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'escape') { menu.close(); drawMenuOnly(); editor.pointerCancel(); return; }
  if (document.querySelector('dialog[open]')) return;
  usePointer();
  if (KEY_ELEMENTS[k] && !e.shiftKey) { editor.setElement(KEY_ELEMENTS[k]); return; }
  if (['1', '2', '3'].includes(k)) { editor.setBondOrder(Number(k)); return; }
  const map = { d: () => editor.setTool('draw'), m: () => editor.setTool('move'), e: () => editor.setTool('erase'), q: () => editor.setTool('charge'), b: () => editor.setRing('benzene'), enter: () => runCommand('analyze'), delete: () => editor.setTool('erase') };
  if (k === 'f' && e.shiftKey) { runCommand('fit'); return; }
  if (map[k]) { e.preventDefault(); map[k](); return; }
  if (k === '?') openDialog('dlg-help');
  if (k === 'v') $('btn-voice').click();
});

// ------------------------------------------------------------ hand tracking
function setHandStatus(text, cls = '') {
  const chip = $('hand-status');
  chip.className = `chip ${cls}`;
  chip.querySelector('span').textContent = text;
}

function updateMinimap() {
  $('minimap').hidden = !hand.active || !settings.get('minimap');
  $('minimap').classList.toggle('preview', settings.get('preview'));
}

$('btn-hand').addEventListener('click', async () => {
  const btn = $('btn-hand');
  if (hand.active) {
    hand.stop();
    btn.setAttribute('aria-pressed', 'false');
    setHandStatus('Mouse / touch mode');
    $('perf').hidden = true;
    updateMinimap();
    logger.log('hand-tracking-off');
    return;
  }
  btn.disabled = true;
  setHandStatus('Starting camera…', 'warn');
  try {
    await hand.start();
    btn.setAttribute('aria-pressed', 'true');
    setHandStatus(`Hand tracking on (${hand.tracker.delegate}) · show your hand`, 'on');
    $('perf').hidden = false;
    updateMinimap();
    logger.log('hand-tracking-on', { delegate: hand.tracker.delegate });
    if (!settings.get('seenGuide')) { openDialog('dlg-help'); settings.set('seenGuide', true); }
  } catch (err) {
    hand.stop();
    setHandStatus('Mouse / touch mode');
    toast(`Hand tracking unavailable: ${err.message}`, { error: true, ms: 4000 });
  } finally {
    btn.disabled = false;
  }
});
hand.addEventListener('status', (e) => setHandStatus(e.detail, 'warn'));
hand.addEventListener('status-change', () => {
  if (!hand.active) return;
  const present = hand.gestures.present;
  setHandStatus(present ? 'Hand detected' : 'Hand tracking on · no hand in view', present ? 'on' : 'warn');
});
let perfTick = 0;
hand.addEventListener('frame', (e) => {
  const st = e.detail;
  if (++perfTick % 10 === 0) {
    const s = hand.tracker.stats;
    $('perf').textContent = `${s.fps.toFixed(0)} fps · ${s.inferMs.toFixed(1)} ms`;
  }
  if (st.present) {
    const poseText = { pinch: 'Pinch', point: 'Pointing', open_palm: 'Open palm (rest)', fist: 'Fist: panning', victory: 'Victory: hold to undo', thumbs_up: 'Thumbs-up: hold to analyse', three: 'Three fingers: hold for menu', none: 'Hand detected' }[st.pose] ?? 'Hand detected';
    $('hand-status').querySelector('span').textContent = poseText;
  }
});
hand.addEventListener('command', (e) => runCommand(e.detail.name, 'gesture'));
hand.addEventListener('menu-select', (e) => selectElement(e.detail.key, 'menu'));
hand.addEventListener('click-feedback', () => earcon('click'));

// ------------------------------------------------------------ voice
$('btn-voice').addEventListener('click', () => {
  const btn = $('btn-voice');
  if (voice.enabled) {
    voice.stop();
    btn.setAttribute('aria-pressed', 'false');
    $('voice-status').hidden = true;
    return;
  }
  try {
    voice.start();
    btn.setAttribute('aria-pressed', 'true');
    $('voice-status').hidden = false;
    toast('Voice on: try “oxygen”, “double bond”, “benzene”, “undo”, “analyse”');
  } catch (err) {
    toast(err.message, { error: true });
  }
});
voice.addEventListener('error', (e) => {
  toast(e.detail, { error: true });
  $('btn-voice').setAttribute('aria-pressed', 'false');
  $('voice-status').hidden = true;
});
voice.addEventListener('heard', (e) => {
  const { transcript, commands } = e.detail;
  logger.log('voice', { modality: 'voice', transcript, commands: commands.map((c) => `${c.type}:${c.value}`) });
  if (!commands.length) { toast(`Heard “${transcript.trim()}” (no command)`); return; }
  for (const c of commands) {
    if (c.type === 'element') selectElement(c.value, 'voice');
    else if (c.type === 'bond') { editor.setBondOrder(c.value); toast(`${c.word} bond`); }
    else if (c.type === 'ring') { editor.setRing(c.value); toast(`${c.value} ring: pinch to place`); }
    else if (c.type === 'tool') { editor.setTool(c.value); toast(`${TOOL_TEXT[c.value]} tool`); }
    else if (c.type === 'command') runCommand(c.value, 'voice');
  }
});

// ------------------------------------------------------------ panels & dialogs
document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  $('tab-props').hidden = tab.dataset.tab !== 'props';
  $('tab-agent').hidden = tab.dataset.tab !== 'agent';
}));
$('btn-library').addEventListener('click', () => library.show());
$('btn-study').addEventListener('click', () => study.show());
$('btn-help').addEventListener('click', () => openDialog('dlg-help'));
$('btn-settings').addEventListener('click', () => { openDialog('dlg-settings'); loadModels(); });
$('btn-copy').addEventListener('click', async () => {
  const s = editor.analysis.smiles;
  if (!s) { toast('Nothing to copy'); return; }
  try { await navigator.clipboard.writeText(s); toast(`Copied ${s}`); } catch { toast(s, { ms: 4000 }); }
});

// Settings dialog <-> settings store.
const bindings = [
  ['set-key', 'groqKey', 'value'], ['set-reach', 'reach', 'number', (v) => `${Math.round(v * 100)}% of camera width`],
  ['set-smoothing', 'smoothing', 'number', (v) => `${v.toFixed(1)} Hz`], ['set-pinch', 'pinch', 'number', (v) => v.toFixed(2)],
  ['set-dwell', 'dwellMs', 'number', (v) => `${v} ms`], ['set-virtualhand', 'virtualHand', 'checked'], ['set-minimap', 'minimap', 'checked'],
  ['set-preview', 'preview', 'checked'], ['set-style', 'atomStyle', 'value'], ['set-theme', 'theme', 'value'],
  ['set-sound', 'sound', 'checked'], ['set-speak', 'speak', 'checked'], ['set-model', 'model', 'value'],
];
for (const [id, key, kind, show] of bindings) {
  const input = $(id);
  const out = $(`out-${id.slice(4)}`);
  const read = () => (kind === 'checked' ? input.checked : kind === 'number' ? Number(input.value) : input.value);
  const write = (v) => { if (kind === 'checked') input.checked = v; else input.value = v; if (out && show) out.textContent = show(Number(v)); };
  write(settings.get(key));
  input.addEventListener(kind === 'value' && input.tagName === 'INPUT' ? 'change' : 'input', () => {
    settings.set(key, read());
    if (out && show) out.textContent = show(read());
  });
}
settings.addEventListener('change', (e) => {
  if (e.detail.key === 'theme') applyTheme();
  if (['minimap', 'preview'].includes(e.detail.key)) updateMinimap();
});

async function loadModels() {
  const sel = $('set-model');
  try {
    const headers = settings.get('groqKey') ? { 'x-groq-key': settings.get('groqKey') } : {};
    const { models, default: dflt } = await (await fetch('/api/models', { headers })).json();
    const current = settings.get('model') || dflt;
    sel.replaceChildren(...models.map((m) => new Option(m, m, false, m === current)));
    if (!models.includes(current)) sel.prepend(new Option(current, current, true, true));
  } catch {
    if (!sel.options.length) sel.append(new Option('openai/gpt-oss-120b', 'openai/gpt-oss-120b', true, true));
  }
}
$('set-key').addEventListener('change', () => { agent.refreshHealth(); loadModels(); });

// ------------------------------------------------------------ startup
applyTheme();
syncState();
updateMinimap();
loadModels();

const params = new URLSearchParams(location.search);
const demo = params.get('demo');
if (demo) {
  const t = TEMPLATES.find((x) => x.name.toLowerCase() === demo.toLowerCase());
  if (t) requestAnimationFrame(() => editor.loadMolecule(templateToMolecule(t), 'load-template', { name: t.name }));
}
if (params.get('smiles')) {
  try { requestAnimationFrame(() => editor.loadMolecule(parseSmiles(params.get('smiles')), 'import-smiles')); } catch { /* ignore bad link */ }
}
if (params.get('tab') === 'agent') document.querySelector('[data-tab="agent"]').click();
