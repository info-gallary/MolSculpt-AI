// Canvas renderer for the molecule, previews (feedforward), highlights and
// valence errors. Two styles: "ball" (large, colour-coded targets suited to
// mid-air pointing) and "skeletal" (textbook line formula).

import { settings } from './settings.js';

const COLORS_LIGHT = {
  C: '#3a4351', H: '#e8edf2', N: '#2d5bd7', O: '#de3a35', S: '#d1a10f', P: '#e47c1c',
  F: '#4fae46', Cl: '#2c9f4d', Br: '#97392a', I: '#7a3c9f', B: '#d48a83', Si: '#b89566', Se: '#c47f27',
};
const COLORS_DARK = { ...COLORS_LIGHT, C: '#c3ccd6', H: '#f2f5f8', N: '#5f86f0', O: '#f05a52', Br: '#c0573f', I: '#a466c9' };

export function atomColor(el, dark = false) {
  return (dark ? COLORS_DARK : COLORS_LIGHT)[el] ?? '#9aa5b1';
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export class Renderer {
  constructor(canvas, editor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.editor = editor;
    this.theme = {};
    this.pending = false;
    this.readTheme();
    new ResizeObserver(() => this.resize()).observe(canvas);
    editor.addEventListener('render', () => this.request());
    editor.addEventListener('change', () => this.request());
    settings.addEventListener('change', () => this.request());
  }

  readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    this.theme = {
      bg: v('--canvas-bg'), dot: v('--grid-dot'), text: v('--text'), muted: v('--muted'),
      accent: v('--accent'), accent2: v('--accent-2'), danger: v('--danger'), warn: v('--warn'),
      dark: (css.colorScheme || '').includes('dark') || luminance(v('--canvas-bg') || '#ffffff') < 0.2,
    };
    this.request();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const first = !this.editor.size.w || this.editor.size.w === 800;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.editor.size = { w: r.width, h: r.height };
    if (first && this.editor.mol.isEmpty) this.editor.view = { scale: 1, ox: r.width / 2, oy: r.height / 2 };
    this.draw();
  }

  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  }

  draw() {
    const { ctx, editor: ed, theme: th } = this;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = ed.size.w, H = ed.size.h;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    this.drawGrid(W, H);

    const s = ed.view.scale;
    ctx.save();
    ctx.translate(ed.view.ox, ed.view.oy);
    ctx.scale(s, s);

    const graph = ed.analysis?.graph;
    const info = new Map();
    if (graph) graph.atoms.forEach((a) => info.set(a.id, a));
    const ringCenter = this.ringCenters(graph);
    const problems = new Set((ed.analysis?.problems ?? []).map((p) => p.atomId));
    const skeletal = settings.get('atomStyle') === 'skeletal';

    // Highlight halo (functional-group brushing from the properties panel).
    if (ed.highlight?.atoms?.size) {
      ctx.fillStyle = `${th.accent2}33`;
      ctx.strokeStyle = `${th.accent2}55`;
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      for (const b of ed.mol.bonds.values()) {
        if (!ed.highlight.atoms.has(b.a) || !ed.highlight.atoms.has(b.b)) continue;
        const A = ed.mol.atoms.get(b.a), B = ed.mol.atoms.get(b.b);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      for (const id of ed.highlight.atoms) {
        const a = ed.mol.atoms.get(id);
        if (!a) continue;
        ctx.beginPath(); ctx.arc(a.x, a.y, 20, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Bonds.
    for (const b of ed.mol.bonds.values()) {
      const A = ed.mol.atoms.get(b.a), B = ed.mol.atoms.get(b.b);
      const hovered = ed.hover?.type === 'bond' && ed.hover.id === b.id;
      const erasing = hovered && ed.tool === 'erase';
      this.drawBond(A, B, b.order, {
        color: erasing ? th.danger : th.text,
        center: ringCenter.get(b.id),
        shortenA: skeletal ? this.labelGap(A, info.get(A.id)) : 0,
        shortenB: skeletal ? this.labelGap(B, info.get(B.id)) : 0,
        hovered,
      });
    }

    // Ghost previews (feedforward of what a pinch/click will do).
    const pv = ed.preview;
    if (pv) {
      ctx.globalAlpha = 0.65;
      this.drawBond(pv.from, pv.to, pv.order, { color: th.accent, dashed: true });
      ctx.globalAlpha = 1;
      if (!pv.fromAtomId) this.drawAtom({ ...pv.from, el: pv.el, charge: 0 }, null, { ghost: true, skeletal });
      if (!pv.toAtomId) this.drawAtom({ ...pv.to, el: pv.el, charge: 0 }, null, { ghost: true, skeletal });
    }
    const gh = ed.ghost;
    if (gh && !ed.drag) {
      if (gh.ring) {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        gh.ring.forEach((v, k) => (k ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      } else if (gh.from) {
        ctx.globalAlpha = 0.45;
        this.drawBond(gh.from, gh, gh.order, { color: th.accent, dashed: true });
        this.drawAtom({ ...gh, charge: 0 }, null, { ghost: true, skeletal });
        ctx.globalAlpha = 1;
      } else if (ed.mol.atoms.size < 400) {
        ctx.globalAlpha = 0.28;
        this.drawAtom({ ...gh, charge: 0 }, null, { ghost: true, skeletal });
        ctx.globalAlpha = 1;
      }
    }

    // Atoms.
    for (const a of ed.mol.atoms.values()) {
      const hovered = ed.hover?.type === 'atom' && ed.hover.id === a.id;
      this.drawAtom(a, info.get(a.id), {
        hovered,
        erasing: hovered && ed.tool === 'erase',
        problem: problems.has(a.id),
        skeletal,
        dragging: ed.drag?.mode === 'atom' && ed.drag.target?.id === a.id,
      });
    }
    ctx.restore();
  }

  drawGrid(W, H) {
    const { ctx, editor: ed } = this;
    const step = 25 * ed.view.scale;
    if (step < 8) return;
    ctx.fillStyle = this.theme.dot;
    const x0 = ((ed.view.ox % step) + step) % step;
    const y0 = ((ed.view.oy % step) + step) % step;
    for (let x = x0; x < W; x += step) {
      for (let y = y0; y < H; y += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
  }

  ringCenters(graph) {
    const map = new Map();
    if (!graph) return map;
    const rings = [...graph.rings].sort((p, q) => p.size - q.size);
    for (const r of rings) {
      // Live positions, so the inner double-bond line follows atoms being dragged.
      const pts = r.atoms.map((i) => this.editor.mol.atoms.get(graph.atoms[i].id)).filter(Boolean);
      if (!pts.length) continue;
      const c ={ x: pts.reduce((s, a) => s + a.x, 0) / pts.length, y: pts.reduce((s, a) => s + a.y, 0) / pts.length };
      for (const bi of r.bonds) {
        const id = graph.bonds[bi].id;
        if (!map.has(id)) map.set(id, c);
      }
    }
    return map;
  }

  labelGap(atom, info) {
    if (!info) return 0;
    if (atom.el !== 'C' || atom.charge || info.degree === 0) return 11;
    return 0;
  }

  drawBond(A, B, order, { color, center, dashed = false, shortenA = 0, shortenB = 0, hovered = false }) {
    const { ctx } = this;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const a = { x: A.x + ux * shortenA, y: A.y + uy * shortenA };
    const b = { x: B.x - ux * shortenB, y: B.y - uy * shortenB };
    ctx.save();
    if (hovered) {
      ctx.strokeStyle = `${this.theme.accent}40`;
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash([6, 5]);
    const line = (p, q) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    if (order === 1) {
      line(a, b);
    } else if (order === 2 && center) {
      // Ring double bond: full outer line, shorter inner line towards the centre.
      line(a, b);
      const side = Math.sign((center.x - A.x) * nx + (center.y - A.y) * ny) || 1;
      const off = 6.5 * side;
      const trim = len * 0.14;
      line({ x: a.x + nx * off + ux * trim, y: a.y + ny * off + uy * trim }, { x: b.x + nx * off - ux * trim, y: b.y + ny * off - uy * trim });
    } else if (order === 2) {
      line({ x: a.x + nx * 3.4, y: a.y + ny * 3.4 }, { x: b.x + nx * 3.4, y: b.y + ny * 3.4 });
      line({ x: a.x - nx * 3.4, y: a.y - ny * 3.4 }, { x: b.x - nx * 3.4, y: b.y - ny * 3.4 });
    } else {
      line(a, b);
      line({ x: a.x + nx * 5, y: a.y + ny * 5 }, { x: b.x + nx * 5, y: b.y + ny * 5 });
      line({ x: a.x - nx * 5, y: a.y - ny * 5 }, { x: b.x - nx * 5, y: b.y - ny * 5 });
    }
    ctx.restore();
  }

  drawAtom(a, info, { hovered = false, erasing = false, problem = false, ghost = false, skeletal = false, dragging = false }) {
    const { ctx, theme: th } = this;
    const color = atomColor(a.el, th.dark);
    const h = info?.hTotal ?? 0;
    const showCarbon = !skeletal || a.charge || !info || info.degree === 0;
    const r = a.el === 'H' ? 9 : a.el === 'C' ? 11.5 : 13;

    if (hovered || dragging) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, r + 9, 0, Math.PI * 2);
      ctx.fillStyle = erasing ? `${th.danger}38` : `${th.accent}33`;
      ctx.fill();
    }

    if (skeletal) {
      if (a.el !== 'C' || showCarbon) {
        const label = this.skeletalLabel(a, h);
        ctx.font = '600 17px Inter, Segoe UI, system-ui, sans-serif';
        const w = ctx.measureText(label).width;
        ctx.fillStyle = th.bg;
        ctx.fillRect(a.x - w / 2 - 3, a.y - 11, w + 6, 22);
        ctx.fillStyle = a.el === 'C' ? th.text : color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, a.x, a.y + 1);
      } else if (hovered) {
        ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.fillStyle = th.accent; ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(a.x - r * 0.35, a.y - r * 0.4, r * 0.15, a.x, a.y, r);
      grad.addColorStop(0, ghost ? `${color}aa` : `${color}`);
      grad.addColorStop(1, ghost ? `${color}66` : this.shade(color, -0.22));
      ctx.fillStyle = grad;
      ctx.fill();
      if (a.el === 'H' || luminance(color) > 0.6) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = th.muted;
        ctx.stroke();
      }
      ctx.fillStyle = luminance(color) > 0.45 ? '#1b232c' : '#ffffff';
      ctx.font = `700 ${a.el.length > 1 ? 10.5 : 12}px Inter, Segoe UI, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.el, a.x, a.y + 0.5);
      if (h > 0 && !ghost) {
        // Implicit-H badge on the emptiest side of the atom, away from its bonds.
        const txt = h > 1 ? `H${h}` : 'H';
        ctx.font = '600 9.5px Inter, Segoe UI, system-ui, sans-serif';
        const w = ctx.measureText(txt).width + 7;
        const dir = this.freeDirection(a);
        const bx = a.x + Math.cos(dir) * (r + w / 2 + 1) - w / 2;
        const by = a.y + Math.sin(dir) * (r + 7) - 6.5;
        ctx.fillStyle = th.dark ? '#2a3440' : '#ffffff';
        ctx.strokeStyle = th.muted;
        ctx.lineWidth = 1;
        this.roundRect(bx, by, w, 13, 6.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = th.text;
        ctx.fillText(txt, bx + w / 2, by + 7);
      }
    }

    if (a.charge) {
      const cx = a.x + r * 0.8, cy = a.y - r * 0.8;
      ctx.beginPath(); ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = th.bg; ctx.fill();
      ctx.strokeStyle = th.text; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = th.text;
      ctx.font = '700 11px Inter, Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.charge > 0 ? (a.charge > 1 ? `${a.charge}+` : '+') : (a.charge < -1 ? `${-a.charge}−` : '−'), cx, cy + 0.5);
    }

    if (problem) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = th.danger;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, r + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = th.danger;
      ctx.font = '800 13px Inter, Segoe UI, system-ui, sans-serif';
      ctx.fillText('!', a.x - r - 8, a.y - r - 4);
    }
  }

  /** Angle pointing away from the atom's bonds (lower-right when isolated). */
  freeDirection(a) {
    if (!a.id) return Math.PI / 4;
    const nbrs = this.editor.mol.neighbors(a.id);
    if (!nbrs.length) return Math.PI / 4;
    let vx = 0, vy = 0;
    for (const { atom } of nbrs) {
      const d = Math.hypot(atom.x - a.x, atom.y - a.y) || 1;
      vx -= (atom.x - a.x) / d;
      vy -= (atom.y - a.y) / d;
    }
    if (Math.hypot(vx, vy) < 0.3) {
      // Bonds on opposite sides: use the perpendicular, preferring "down".
      const n = nbrs[0].atom;
      const ang = Math.atan2(n.y - a.y, n.x - a.x) + Math.PI / 2;
      return Math.sin(ang) >= 0 ? ang : ang + Math.PI;
    }
    return Math.atan2(vy, vx);
  }

  skeletalLabel(a, h) {
    if (!h) return a.el;
    return `${a.el}H${h > 1 ? String(h).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]) : ''}`;
  }

  roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
  }
}

/** Static thumbnail of a template or molecule for the library / study banner. */
export function drawThumbnail(canvas, atoms, bonds, { dark = false } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!atoms.length) return;
  const xs = atoms.map((a) => a.x), ys = atoms.map((a) => a.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((w - 16) / Math.max(maxX - minX, 1), (h - 16) / Math.max(maxY - minY, 1), 0.6);
  const ox = w / 2 - ((minX + maxX) / 2) * s, oy = h / 2 - ((minY + maxY) / 2) * s;
  const P = (a) => ({ x: a.x * s + ox, y: a.y * s + oy });
  ctx.lineCap = 'round';
  ctx.strokeStyle = dark ? '#c3ccd6' : '#3a4351';
  ctx.lineWidth = 1.4;
  for (const b of bonds) {
    const p = P(atoms[b.a]), q = P(atoms[b.b]);
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 2, ny = (dx / len) * 2;
    const offs = b.order === 1 ? [0] : b.order === 2 ? [-1, 1] : [-1.6, 0, 1.6];
    for (const o of offs) {
      ctx.beginPath();
      ctx.moveTo(p.x + nx * o, p.y + ny * o);
      ctx.lineTo(q.x + nx * o, q.y + ny * o);
      ctx.stroke();
    }
  }
  for (const a of atoms) {
    if (a.el === 'C') continue;
    const p = P(a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = atomColor(a.el, dark);
    ctx.fill();
  }
}
