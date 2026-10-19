// Multimodal feedback: transient toasts (visual) and short earcons (audio),
// so the user knows a gesture was recognised without looking at a panel.

import { settings } from './settings.js';

const host = () => document.getElementById('toasts');

export function toast(message, { error = false, ms = 1800 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  host().append(el);
  while (host().children.length > 3) host().firstElementChild.remove();
  setTimeout(() => el.remove(), ms);
}

let ctx = null;
const TONES = {
  click: [[880, 0.05]],
  place: [[660, 0.06], [990, 0.05]],
  bond: [[520, 0.05], [780, 0.06]],
  erase: [[420, 0.07], [300, 0.07]],
  undo: [[600, 0.05], [450, 0.06]],
  error: [[220, 0.12]],
  success: [[660, 0.08], [880, 0.08], [1320, 0.12]],
  start: [[500, 0.05], [750, 0.08]],
};

export function earcon(name) {
  if (!settings.get('sound') || !TONES[name]) return;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [freq, dur] of TONES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.9;
    }
  } catch { /* audio unavailable */ }
}

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  speechSynthesis.speak(u);
}
