// Overlay ("heads-up display") drawn above the whole UI: the hand cursor and
// its state, dwell / hold progress rings, a virtual hand that follows the
// cursor, the radial element menu and the hand-skeleton mini-map. This is the
// system's continuous feedback channel for mid-air input.

import { HAND_CONNECTIONS } from '../input/gestures.js';
import { atomColor } from './renderer.js';

export const MENU_ITEMS = ['C', 'N', 'O', 'H', 'S', 'F', 'Cl', 'Br'].map((el) => ({ key: el, label: el }));

export class RadialMenu {
  constructor(items = MENU_ITEMS) {
    this.items = items;
    this.active = false;
    this.inner = 40;
    this.outer = 138;
    this.dwellMs = 650;
  }

  open(x, y, t = performance.now()) {
    const m = this.outer + 12;
    this.cx = Math.min(innerWidth - m, Math.max(m, x));
    this.cy = Math.min(innerHeight - m, Math.max(m, y));
    this.active = true;
    this.hover = -1;
    this.hoverSince = t;
    this.openedAt = t;
  }

  close() { this.active = false; this.hover = -1; }

  indexAt(x, y) {
    const dx = x - this.cx, dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    if (r < this.inner || r > this.outer + 60) return -1;
    const n = this.items.length;
    const a = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n + Math.PI * 4) % (Math.PI * 2);
    return Math.floor((a / (Math.PI * 2)) * n) % n;
  }

  /** Track the cursor; returns the item chosen by dwelling, if any. */
  update(x, y, t = performance.now()) {
    const i = this.indexAt(x, y);
    if (i !== this.hover) { this.hover = i; this.hoverSince = t; }
    this.progress = i >= 0 ? Math.min(1, (t - this.hoverSince) / this.dwellMs) : 0;
    return i >= 0 && this.progress >= 1 ? this.items[i] : null;
  }
}

export class Hud {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    this.mctx = minimap?.getContext('2d');
    this.state = null;
    this.extras = {};
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
  }

  colors() {
    const css = getComputedStyle(document.documentElement);
    return { accent: css.getPropertyValue('--accent').trim(), accent2: css.getPropertyValue('--accent-2').trim(), text: css.getPropertyValue('--text').trim(), surface: css.getPropertyValue('--surface').trim(), muted: css.getPropertyValue('--muted').trim() };
  }

  draw(state, { dwell = null, menu = null, virtualHand = true, capture = false, aspect = 4 / 3 } = {}) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const c = this.colors();
    if (menu?.active) this.drawMenu(menu, c);
    if (!state?.present) return;
    const { x, y } = state;

    if (virtualHand && state.landmarks) this.drawVirtualHand(state, c, aspect);

    // Hold-gesture progress ring with a label.
    if (state.hold && !state.hold.done) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = `${c.accent2}40`;
      ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = c.accent2;
      ctx.beginPath(); ctx.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.hold.progress); ctx.stroke();
      this.label(`${state.hold.label}…`, x, y - 52, c);
    }

    if (dwell && dwell.progress > 0) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = c.accent;
      ctx.beginPath(); ctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * dwell.progress); ctx.stroke();
    }

    if (state.grabbing) {
      ctx.fillStyle = `${c.accent}30`;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(state.palm.x, state.palm.y, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      this.label('Panning', state.palm.x, state.palm.y - 46, c);
      return;
    }

    // Cursor: hollow when hovering, filled and smaller while pinched.
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.accent;
    ctx.fillStyle = state.pinching ? c.accent : `${c.accent}26`;
    ctx.beginPath();
    ctx.arc(x, y, state.pinching ? 9 : 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.surface;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    if (capture) {
      ctx.strokeStyle = `${c.accent}80`;
      ctx.beginPath(); ctx.arc(x, y, 21, 0, Math.PI * 2); ctx.stroke();
    }
  }

  label(text, x, y, c) {
    const { ctx } = this;
    ctx.font = '600 13px Inter, Segoe UI, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = c.text;
    ctx.beginPath();
    ctx.roundRect?.(x - w / 2, y - 13, w, 26, 13);
    if (!ctx.roundRect) ctx.rect(x - w / 2, y - 13, w, 26);
    ctx.fill();
    ctx.fillStyle = c.surface;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  drawVirtualHand(state, c, aspect) {
    const { ctx } = this;
    const L = state.landmarks.map((p) => ({ x: p.x * aspect, y: p.y }));
    const anchor = { x: (L[4].x + L[8].x) / 2, y: (L[4].y + L[8].y) / 2 };
    const size = Math.hypot(L[0].x - L[9].x, L[0].y - L[9].y) || 1;
    const k = 78 / size;
    const P = (p) => ({ x: state.x + (p.x - anchor.x) * k, y: state.y + (p.y - anchor.y) * k });
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [i, j] of HAND_CONNECTIONS) {
      const a = P(L[i]), b = P(L[j]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.fillStyle = c.muted;
    for (const i of [4, 8, 12, 16, 20]) {
      const p = P(L[i]);
      ctx.beginPath(); ctx.arc(p.x, p.y, i === 4 || i === 8 ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawMenu(menu, c) {
    const { ctx } = this;
    const n = menu.items.length;
    const { cx, cy, inner, outer } = menu;
    ctx.save();
    ctx.fillStyle = `${c.surface}f2`;
    ctx.strokeStyle = `${c.muted}60`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, outer, 0, Math.PI * 2); ctx.arc(cx, cy, inner, 0, Math.PI * 2, true); ctx.fill('evenodd');
    menu.items.forEach((item, i) => {
      const a0 = -Math.PI / 2 - Math.PI / n + (i * Math.PI * 2) / n;
      const a1 = a0 + (Math.PI * 2) / n;
      if (i === menu.hover) {
        ctx.fillStyle = `${c.accent}33`;
        ctx.beginPath(); ctx.arc(cx, cy, outer, a0, a1); ctx.arc(cx, cy, inner, a1, a0, true); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, outer - 3, a0, a0 + (a1 - a0) * (menu.progress ?? 0)); ctx.stroke();
      }
      ctx.strokeStyle = `${c.muted}50`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx + inner * Math.cos(a0), cy + inner * Math.sin(a0)); ctx.lineTo(cx + outer * Math.cos(a0), cy + outer * Math.sin(a0)); ctx.stroke();
      const am = (a0 + a1) / 2;
      const r = (inner + outer) / 2;
      const px = cx + r * Math.cos(am), py = cy + r * Math.sin(am);
      ctx.fillStyle = atomColor(item.key);
      ctx.beginPath(); ctx.arc(px, py, 21, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ['H', 'S', 'F'].includes(item.key) ? '#1b232c' : '#fff';
      ctx.font = '700 15px Inter, Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, px, py + 0.5);
    });
    ctx.fillStyle = c.muted;
    ctx.font = '600 11px Inter, Segoe UI, system-ui, sans-serif';
    ctx.fillText('pinch / dwell', cx, cy - 6);
    ctx.fillText('centre = close', cx, cy + 8);
    ctx.restore();
  }

  drawMinimap(state, reach) {
    const ctx = this.mctx;
    if (!ctx) return;
    const W = this.minimap.width, H = this.minimap.height;
    ctx.clearRect(0, 0, W, H);
    const c = this.colors();
    const rw = reach * W, rh = reach * 0.9 * H;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect((W - rw) / 2, (H - rh) / 2, rw, rh);
    ctx.setLineDash([]);
    if (!state?.present || !state.landmarks) {
      ctx.fillStyle = c.muted;
      ctx.font = '12px Inter, Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Show your hand', W / 2, H / 2);
      return;
    }
    const P = (p) => ({ x: p.x * W, y: p.y * H });
    ctx.strokeStyle = state.pinching ? c.accent2 : c.accent;
    ctx.lineWidth = 2;
    for (const [i, j] of HAND_CONNECTIONS) {
      const a = P(state.landmarks[i]), b = P(state.landmarks[j]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.fillStyle = c.text;
    for (const p of state.landmarks) { const q = P(p); ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); }
  }
}
