// Editable molecular graph. Coordinates are canvas pixels; bond orders are
// Kekulé integers (1, 2, 3). Aromaticity is perceived later, never stored.

export class Molecule {
  constructor() {
    this.atoms = new Map();
    this.bonds = new Map();
    this._next = 1;
  }

  _id() {
    return this._next++;
  }

  get isEmpty() {
    return this.atoms.size === 0;
  }

  addAtom(el, x = 0, y = 0, { charge = 0, hExplicit = null } = {}) {
    const atom = { id: this._id(), el, x, y, charge, hExplicit };
    this.atoms.set(atom.id, atom);
    return atom;
  }

  addBond(a, b, order = 1) {
    if (a === b || !this.atoms.has(a) || !this.atoms.has(b)) return null;
    const existing = this.bondBetween(a, b);
    if (existing) return existing;
    const bond = { id: this._id(), a, b, order };
    this.bonds.set(bond.id, bond);
    return bond;
  }

  bondBetween(a, b) {
    for (const bd of this.bonds.values()) {
      if ((bd.a === a && bd.b === b) || (bd.a === b && bd.b === a)) return bd;
    }
    return null;
  }

  bondsOf(id) {
    const out = [];
    for (const bd of this.bonds.values()) if (bd.a === id || bd.b === id) out.push(bd);
    return out;
  }

  neighbors(id) {
    return this.bondsOf(id).map((bond) => ({
      bond,
      atom: this.atoms.get(bond.a === id ? bond.b : bond.a),
    }));
  }

  bondOrderSum(id) {
    return this.bondsOf(id).reduce((s, b) => s + b.order, 0);
  }

  removeAtom(id) {
    for (const b of this.bondsOf(id)) this.bonds.delete(b.id);
    this.atoms.delete(id);
  }

  removeBond(id) {
    this.bonds.delete(id);
  }

  clear() {
    this.atoms.clear();
    this.bonds.clear();
  }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of this.atoms.values()) {
      minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  translate(dx, dy) {
    for (const a of this.atoms.values()) { a.x += dx; a.y += dy; }
  }

  /** Copy every atom and bond of `other` into this molecule; returns id map. */
  merge(other) {
    const map = new Map();
    for (const a of other.atoms.values()) {
      const n = this.addAtom(a.el, a.x, a.y, { charge: a.charge, hExplicit: a.hExplicit });
      map.set(a.id, n.id);
    }
    for (const b of other.bonds.values()) this.addBond(map.get(b.a), map.get(b.b), b.order);
    return map;
  }

  toJSON() {
    return {
      atoms: [...this.atoms.values()].map((a) => ({ ...a })),
      bonds: [...this.bonds.values()].map((b) => ({ ...b })),
      next: this._next,
    };
  }

  static fromJSON(json) {
    const m = new Molecule();
    for (const a of json.atoms) m.atoms.set(a.id, { charge: 0, hExplicit: null, ...a });
    for (const b of json.bonds) m.bonds.set(b.id, { ...b });
    const maxId = Math.max(0, ...json.atoms.map((a) => a.id), ...json.bonds.map((b) => b.id));
    m._next = Math.max(json.next ?? 0, maxId + 1);
    return m;
  }

  clone() {
    return Molecule.fromJSON(this.toJSON());
  }
}
