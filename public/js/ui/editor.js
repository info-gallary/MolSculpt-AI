// Modality-independent editing model. Mouse, touch, hand gestures and voice
// all drive the same small interface: hover / down / move / up / cancel plus
// commands. Assistive behaviour that compensates for noisy mid-air input
// lives here: enlarged hit areas, 30° angle snapping, fixed bond length,
// magnetic snapping to nearby atoms and valence-aware error prevention.

import { Molecule } from '../chem/molecule.js';
import { analyze, layoutMolecule } from '../chem/index.js';
import { allowedValences, ELEMENTS } from '../chem/elements.js';
import { logger } from './logger.js';

export const BOND_LENGTH = 50;
const TAU = Math.PI * 2;
const DRAG_THRESHOLD = 10;
const HISTORY_LIMIT = 150;

const angDiff = (a, b) => {
  let d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

export class Editor extends EventTarget {
  constructor() {
    super();
    this.mol = new Molecule();
    this.tool = 'draw';
    this.element = 'C';
    this.bondOrder = 1;
    this.ring = null;
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.size = { w: 800, h: 600 };
    this.undoStack = [];
    this.redoStack = [];
    this.hover = null;
    this.preview = null;
    this.ghost = null;
    this.highlight = null;
    this.drag = null;
    this.modality = 'mouse';
    this.analysis = analyze(this.mol);
  }

  // ---------------------------------------------------------- geometry

  get hitRadius() { return this.modality === 'hand' ? 30 : 18; }
  get snapRadius() { return this.modality === 'hand' ? 40 : 24; }

  toWorld(p) { return { x: (p.x - this.view.ox) / this.view.scale, y: (p.y - this.view.oy) / this.view.scale }; }
  toScreen(p) { return { x: p.x * this.view.scale + this.view.ox, y: p.y * this.view.scale + this.view.oy }; }

  atomAt(p, radius = this.hitRadius, excludeId = null) {
    let best = null;
    let bestD = radius;
    for (const a of this.mol.atoms.values()) {
      if (a.id === excludeId) continue;
      const s = this.toScreen(a);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= bestD) { bestD = d; best = a; }
    }
    return best;
  }

  bondAt(p, tol = this.modality === 'hand' ? 16 : 10) {
    let best = null;
    let bestD = tol;
    for (const b of this.mol.bonds.values()) {
      const A = this.toScreen(this.mol.atoms.get(b.a));
      const B = this.toScreen(this.mol.atoms.get(b.b));
      const dx = B.x - A.x, dy = B.y - A.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0.15, Math.min(0.85, ((p.x - A.x) * dx + (p.y - A.y) * dy) / len2));
      const d = Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy));
      if (d <= bestD) { bestD = d; best = b; }
    }
    return best;
  }

  targetAt(p) {
    const a = this.atomAt(p);
    if (a) return { type: 'atom', id: a.id };
    const b = this.bondAt(p);
    if (b) return { type: 'bond', id: b.id };
    return null;
  }

  freeValence(atom, extraOrder = 0) {
    const used = this.mol.bondOrderSum(atom.id) + extraOrder;
    return Math.max(...allowedValences(ELEMENTS[atom.el].z, atom.charge)) - used;
  }

  /** Best direction for a new bond from `atom`: zig-zag chains, largest gap, no collisions. */
  growthPosition(atom, order = this.bondOrder) {
    const nbrs = this.mol.neighbors(atom.id);
    const angs = nbrs.map(({ atom: n }) => Math.atan2(n.y - atom.y, n.x - atom.x));
    let ideal;
    if (!nbrs.length) {
      ideal = [-Math.PI / 6];
    } else if (nbrs.length === 1) {
      const nb = nbrs[0].atom;
      const linear = order === 3 || nbrs[0].bond.order === 3 || (order === 2 && nbrs[0].bond.order === 2);
      const second = this.mol.neighbors(nb.id).map((x) => x.atom).filter((x) => x.id !== atom.id);
      if (linear) ideal = [angs[0] + Math.PI];
      else if (second.length) ideal = [Math.atan2(nb.y - second[0].y, nb.x - second[0].x)];
      else ideal = [angs[0] + TAU / 3, angs[0] - TAU / 3];
    } else {
      const sorted = angs.map((a) => (a + TAU) % TAU).sort((x, y) => x - y);
      let start = sorted[sorted.length - 1];
      let gap = sorted[0] + TAU - start;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] > gap) { gap = sorted[i] - sorted[i - 1]; start = sorted[i - 1]; }
      }
      ideal = [start + gap / 2];
    }
    let best = null;
    for (let k = 0; k < 24; k++) {
      const phi = (k * TAU) / 24;
      const x = atom.x + BOND_LENGTH * Math.cos(phi);
      const y = atom.y + BOND_LENGTH * Math.sin(phi);
      let score = Math.min(...ideal.map((i) => angDiff(phi, i)));
      for (const q of this.mol.atoms.values()) {
        if (q.id === atom.id) continue;
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < BOND_LENGTH * 0.9) score += (BOND_LENGTH * 0.9 - d) / 6;
      }
      if (!best || score < best.score) best = { x, y, score };
    }
    return best;
  }

  // ---------------------------------------------------------- history

  snapshot() { return JSON.stringify(this.mol.toJSON()); }

  restore(json) { this.mol = Molecule.fromJSON(JSON.parse(json)); }

  commit(before, label, data = {}) {
    if (before === this.snapshot()) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed(label, data);
    return true;
  }

  changed(label, data = {}) {
    this.analysis = analyze(this.mol);
    this.hover = null;
    logger.log(label, { ...data, atoms: this.mol.atoms.size, bonds: this.mol.bonds.size });
    this.dispatchEvent(new CustomEvent('change', { detail: { label, ...data } }));
    this.render();
  }

  undo() {
    if (!this.undoStack.length) { this.warn('Nothing to undo'); return false; }
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    this.changed('undo');
    return true;
  }

  redo() {
    if (!this.redoStack.length) { this.warn('Nothing to redo'); return false; }
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    this.changed('redo');
    return true;
  }

  clear() {
    if (this.mol.isEmpty) return;
    const before = this.snapshot();
    this.mol.clear();
    this.commit(before, 'clear');
  }

  render() { this.dispatchEvent(new Event('render')); }

  warn(message) {
    logger.log('warning', { message });
    this.dispatchEvent(new CustomEvent('warn', { detail: { message } }));
  }

  // ---------------------------------------------------------- tools

  setTool(tool) {
    this.tool = tool;
    if (tool !== 'ring') this.ring = null;
    this.ghost = null;
    this.preview = null;
    logger.log('set-tool', { tool });
    this.dispatchEvent(new Event('state'));
    this.render();
  }

  setRing(kind) {
    this.ring = kind;
    this.tool = 'ring';
    logger.log('set-ring', { ring: kind });
    this.dispatchEvent(new Event('state'));
    this.render();
  }

  setElement(el) {
    this.element = el;
    if (this.tool !== 'draw') this.tool = 'draw';
    this.ring = null;
    logger.log('set-element', { element: el });
    this.dispatchEvent(new Event('state'));
    this.render();
  }

  setBondOrder(order) {
    this.bondOrder = order;
    if (this.tool !== 'draw') this.tool = 'draw';
    this.ring = null;
    logger.log('set-bond-order', { order });
    this.dispatchEvent(new Event('state'));
  }

  // ---------------------------------------------------------- pointer

  pointerHover(p) {
    if (this.drag) return;
    const target = this.targetAt(p);
    this.hover = target;
    this.ghost = null;
    if (this.tool === 'draw') {
      if (!target) {
        this.ghost = { ...this.toWorld(p), el: this.element };
      } else if (target.type === 'atom') {
        const atom = this.mol.atoms.get(target.id);
        if (atom.el === this.element && this.freeValence(atom, this.bondOrder) >= 0) {
          const g = this.growthPosition(atom);
          this.ghost = { x: g.x, y: g.y, el: this.element, from: { x: atom.x, y: atom.y }, order: this.bondOrder };
        }
      }
    } else if (this.tool === 'ring') {
      this.ghost = { ring: this.ringVertices(p, target), aromatic: this.ring === 'benzene' };
    }
    this.render();
  }

  pointerDown(p) {
    const target = this.targetAt(p);
    this.drag = { start: p, last: p, target, moved: false, before: this.snapshot(), erased: 0 };
    this.hover = target;
    this.ghost = null;
    if (this.tool === 'erase') this.eraseAt(p);
    if (this.tool === 'move') {
      this.drag.mode = target?.type === 'atom' ? 'atom' : 'pan';
      logger.log('grab', { what: this.drag.mode });
    }
    this.render();
  }

  pointerMove(p) {
    const d = this.drag;
    if (!d) { this.pointerHover(p); return; }
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_THRESHOLD) d.moved = true;
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    d.last = p;
    switch (this.tool) {
      case 'draw':
        if (d.moved && d.target?.type !== 'bond') this.updateBondPreview(p);
        break;
      case 'move':
        if (d.mode === 'atom') {
          const a = this.mol.atoms.get(d.target.id);
          const w = this.toWorld(p);
          a.x = w.x; a.y = w.y;
        } else {
          this.panBy(dx, dy);
        }
        break;
      case 'erase':
        this.eraseAt(p);
        break;
      default:
        break;
    }
    this.render();
  }

  pointerUp(p) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const preview = this.preview;
    this.preview = null;
    switch (this.tool) {
      case 'draw':
        if (!d.moved || d.target?.type === 'bond' || !preview) this.tap(d.target, d.start, d.before);
        else this.finishBond(preview, d.before);
        break;
      case 'ring':
        this.placeRing(d.start, d.target, d.before);
        break;
      case 'move':
        if (d.mode === 'atom') this.commit(d.before, 'move-atom');
        break;
      case 'erase':
        this.commit(d.before, 'erase', { count: d.erased });
        break;
      case 'charge':
        if (d.target?.type === 'atom') this.cycleCharge(d.target.id, d.before);
        break;
      default:
        break;
    }
    this.pointerHover(p);
  }

  pointerCancel() {
    if (!this.drag) return;
    if (this.drag.before !== this.snapshot()) this.restore(this.drag.before);
    this.drag = null;
    this.preview = null;
    logger.log('cancel');
    this.render();
  }

  panBy(dx, dy) {
    this.view.ox += dx;
    this.view.oy += dy;
    this.render();
  }

  zoomAt(p, factor) {
    const s = Math.min(3, Math.max(0.3, this.view.scale * factor));
    const w = this.toWorld(p);
    this.view.scale = s;
    this.view.ox = p.x - w.x * s;
    this.view.oy = p.y - w.y * s;
    this.render();
  }

  fit() {
    const b = this.mol.bounds();
    if (!b) { this.view = { scale: 1, ox: this.size.w / 2, oy: this.size.h / 2 }; this.render(); return; }
    const pad = 90;
    const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
    const s = Math.min(1.35, Math.max(0.35, Math.min((this.size.w - 2 * pad) / w, (this.size.h - 2 * pad) / h)));
    this.view = { scale: s, ox: this.size.w / 2 - b.cx * s, oy: this.size.h / 2 - b.cy * s };
    this.render();
  }

  // ---------------------------------------------------------- operations

  tap(target, p, before) {
    if (!target) {
      const w = this.toWorld(p);
      this.mol.addAtom(this.element, w.x, w.y);
      this.commit(before, 'add-atom', { element: this.element });
      return;
    }
    if (target.type === 'atom') {
      const atom = this.mol.atoms.get(target.id);
      if (atom.el !== this.element) {
        const from = atom.el;
        atom.el = this.element;
        this.commit(before, 'change-element', { from, to: this.element });
        if (this.freeValence(atom) < 0) this.warn(`${ELEMENTS[atom.el].name} now exceeds its valence`);
        return;
      }
      if (this.freeValence(atom, this.bondOrder) < 0) {
        this.warn(`${ELEMENTS[atom.el].name} has no free valence for a ${['', 'single', 'double', 'triple'][this.bondOrder]} bond`);
        return;
      }
      const pos = this.growthPosition(atom);
      const n = this.mol.addAtom(this.element, pos.x, pos.y);
      this.mol.addBond(atom.id, n.id, this.bondOrder);
      this.commit(before, 'grow-chain', { element: this.element, order: this.bondOrder });
      return;
    }
    const bond = this.mol.bonds.get(target.id);
    const A = this.mol.atoms.get(bond.a), B = this.mol.atoms.get(bond.b);
    // Cycle 1 -> 2 -> 3 -> 1, skipping orders that would break a valence.
    for (let k = 1; k <= 3; k++) {
      const next = ((bond.order - 1 + k) % 3) + 1;
      const extra = next - bond.order;
      if (next === 1 || (this.freeValence(A, extra) >= 0 && this.freeValence(B, extra) >= 0)) {
        bond.order = next;
        break;
      }
    }
    this.commit(before, 'bond-order', { order: bond.order });
  }

  updateBondPreview(p) {
    const d = this.drag;
    const fromAtom = d.target?.type === 'atom' ? this.mol.atoms.get(d.target.id) : null;
    const from = fromAtom ? { x: fromAtom.x, y: fromAtom.y } : this.toWorld(d.start);
    const snap = this.atomAt(p, this.snapRadius, fromAtom?.id);
    let to;
    let toAtomId = null;
    if (snap) {
      to = { x: snap.x, y: snap.y };
      toAtomId = snap.id;
    } else {
      const w = this.toWorld(p);
      const step = Math.PI / 6;
      const ang = Math.round(Math.atan2(w.y - from.y, w.x - from.x) / step) * step;
      to = { x: from.x + BOND_LENGTH * Math.cos(ang), y: from.y + BOND_LENGTH * Math.sin(ang) };
      const near = this.atomAt(this.toScreen(to), BOND_LENGTH * 0.35 * this.view.scale, fromAtom?.id);
      if (near) { to = { x: near.x, y: near.y }; toAtomId = near.id; }
    }
    this.preview = { from, to, fromAtomId: fromAtom?.id ?? null, toAtomId, el: this.element, order: this.bondOrder };
  }

  finishBond(pv, before) {
    const order = this.bondOrder;
    const fromAtom = pv.fromAtomId ? this.mol.atoms.get(pv.fromAtomId) : null;
    const toAtom = pv.toAtomId ? this.mol.atoms.get(pv.toAtomId) : null;
    const existing = fromAtom && toAtom ? this.mol.bondBetween(fromAtom.id, toAtom.id) : null;
    const extra = existing ? order - existing.order : order;
    const blocked = [fromAtom, toAtom].find((a) => a && this.freeValence(a, extra) < 0);
    if (blocked) {
      this.warn(`${ELEMENTS[blocked.el].name} has no free valence for that bond`);
      return;
    }
    const a = fromAtom ?? this.mol.addAtom(this.element, pv.from.x, pv.from.y);
    const b = toAtom ?? this.mol.addAtom(this.element, pv.to.x, pv.to.y);
    if (existing) existing.order = order;
    else this.mol.addBond(a.id, b.id, order);
    this.commit(before, existing ? 'bond-order' : 'add-bond', { order, ringClosure: Boolean(toAtom && fromAtom) });
  }

  eraseAt(p) {
    const t = this.targetAt(p);
    if (!t) return;
    if (t.type === 'atom') this.mol.removeAtom(t.id);
    else this.mol.removeBond(t.id);
    this.drag.erased++;
    this.hover = null;
  }

  cycleCharge(id, before) {
    const atom = this.mol.atoms.get(id);
    atom.charge = atom.charge === 0 ? 1 : atom.charge === 1 ? -1 : 0;
    this.commit(before, 'charge', { charge: atom.charge });
  }

  ringSize() { return this.ring === 'cyclopentane' ? 5 : 6; }

  /** World-space vertices of the ring that a click at p would create. */
  ringVertices(p, target) {
    const n = this.ringSize();
    const R = BOND_LENGTH / (2 * Math.sin(Math.PI / n));
    const step = TAU / n;
    const around = (c, a0, dir) => Array.from({ length: n }, (_, k) => ({
      x: c.x + R * Math.cos(a0 + dir * k * step),
      y: c.y + R * Math.sin(a0 + dir * k * step),
    }));

    if (target?.type === 'bond') {
      const bond = this.mol.bonds.get(target.id);
      const A = this.mol.atoms.get(bond.a), B = this.mol.atoms.get(bond.b);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
      // Put the new ring on the side away from the existing neighbours.
      let sx = 0, sy = 0;
      for (const id of [A.id, B.id]) {
        for (const { atom } of this.mol.neighbors(id)) {
          if (atom.id === A.id || atom.id === B.id) continue;
          sx += atom.x - mid.x; sy += atom.y - mid.y;
        }
      }
      if (nx * sx + ny * sy > 0) { nx = -nx; ny = -ny; }
      const apothem = BOND_LENGTH / (2 * Math.tan(Math.PI / n));
      const c = { x: mid.x + nx * apothem, y: mid.y + ny * apothem };
      const aA = Math.atan2(A.y - c.y, A.x - c.x);
      const aB = Math.atan2(B.y - c.y, B.x - c.x);
      let delta = aB - aA;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      return around(c, aA, Math.sign(delta));
    }
    if (target?.type === 'atom') {
      const A = this.mol.atoms.get(target.id);
      const g = this.mol.neighbors(A.id).length ? this.growthPosition(A, 1) : { x: A.x, y: A.y - BOND_LENGTH };
      const phi = Math.atan2(g.y - A.y, g.x - A.x);
      const c = { x: A.x + R * Math.cos(phi), y: A.y + R * Math.sin(phi) };
      return around(c, phi + Math.PI, 1);
    }
    const c = this.toWorld(p);
    return around(c, -Math.PI / 2, 1);
  }

  placeRing(p, target, before) {
    const verts = this.ringVertices(p, target);
    const ids = verts.map((v) => {
      const s = this.toScreen(v);
      const existing = this.atomAt(s, BOND_LENGTH * 0.3 * this.view.scale);
      return (existing ?? this.mol.addAtom('C', v.x, v.y)).id;
    });
    const n = ids.length;
    const ringBonds = [];
    for (let k = 0; k < n; k++) ringBonds.push(this.mol.addBond(ids[k], ids[(k + 1) % n], 1));
    if (this.ring === 'benzene') {
      // Kekulé pattern that respects double bonds already on shared atoms.
      const hasDouble = (id) => this.mol.bondsOf(id).some((b) => b.order === 2);
      const start = ringBonds.findIndex((b) => b.order === 2);
      for (let k = 0; k < n; k++) {
        const b = ringBonds[(Math.max(start, 0) + k) % n];
        if (b.order === 1 && !hasDouble(b.a) && !hasDouble(b.b)) {
          const A = this.mol.atoms.get(b.a), B = this.mol.atoms.get(b.b);
          if (this.freeValence(A, 1) >= 0 && this.freeValence(B, 1) >= 0) b.order = 2;
        }
      }
    }
    this.commit(before, 'add-ring', { ring: this.ring, fused: target?.type ?? 'none' });
  }

  /** Replace the canvas content (library, SMILES import, AI analogue). */
  loadMolecule(mol, label = 'load', data = {}) {
    const before = this.snapshot();
    const atoms = [...mol.atoms.values()];
    if (atoms.length && atoms.every((a) => a.x === 0 && a.y === 0)) layoutMolecule(mol, { bondLength: BOND_LENGTH });
    this.mol = mol;
    this.commit(before, label, data);
    this.fit();
  }
}
