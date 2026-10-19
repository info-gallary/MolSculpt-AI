// User preferences, persisted per browser. Storage can be unavailable
// (private mode, blocked site data), so every access is guarded.

const KEY = 'molsculpt.settings.v1';

export const DEFAULTS = {
  groqKey: '',
  model: '',
  focus: 'drug',
  reach: 0.6,
  smoothing: 1.2,
  pinch: 0.3,
  dwellMs: 900,
  virtualHand: true,
  minimap: true,
  preview: false,
  atomStyle: 'ball',
  theme: 'auto',
  sound: true,
  speak: false,
  seenGuide: false,
};

class Settings extends EventTarget {
  constructor() {
    super();
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }
    this.values = { ...DEFAULTS, ...stored };
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* not persisted */ }
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  }
}

export const settings = new Settings();
