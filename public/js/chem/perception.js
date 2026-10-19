// Chemical perception: turns an editable Molecule into an index-based graph
// annotated with implicit hydrogens, valence problems, SSSR rings and
// Hückel aromaticity. Every descriptor and pattern match runs on this graph.

import { ELEMENTS, allowedValences } from './elements.js';
import { findSSSR } from './rings.js';

/**
 * @param {import('./molecule.js').Molecule} mol
 */
export function perceive(mol) {
  const src = [...mol.atoms.values()];

  // 1. Fold explicitly drawn terminal hydrogens into their heavy atom.
  const folded = new Set();
  const extraH = new Map();
  for (const a of src) {
    if (a.el !== 'H' || a.charge) continue;
    const nb = mol.neighbors(a.id);
    if (nb.length === 1 && nb[0].bond.order === 1 && nb[0].atom.el !== 'H') {
      folded.add(a.id);
      extraH.set(nb[0].atom.id, (extraH.get(nb[0].atom.id) || 0) + 1);
    }
  }

  const atoms = [];
  const index = new Map();
  for (const a of src) {
    if (folded.has(a.id)) continue;
    index.set(a.id, atoms.length);
    atoms.push({
      id: a.id, el: a.el, z: ELEMENTS[a.el]?.z ?? 0, charge: a.charge || 0,
      hExplicit: a.hExplicit ?? null, hFolded: extraH.get(a.id) || 0,
      x: a.x, y: a.y,
    });
  }
  const bonds = [];
  for (const b of mol.bonds.values()) {
    if (folded.has(b.a) || folded.has(b.b)) continue;
    bonds.push({ id: b.id, a: index.get(b.a), b: index.get(b.b), order: b.order, aromatic: false, inRing: false });
  }

  const notes = [];
  normaliseNitro(atoms, bonds, notes);

  const adj = atoms.map(() => []);
  bonds.forEach((b, bi) => {
    adj[b.a].push({ nbr: b.b, bond: bi });
    adj[b.b].push({ nbr: b.a, bond: bi });
  });

  // 2. Valence model and implicit hydrogens.
  const problems = [];
  atoms.forEach((a, i) => {
    const bondSum = adj[i].reduce((s, e) => s + bonds[e.bond].order, 0) + a.hFolded;
    const vals = allowedValences(a.z, a.charge);
    const maxVal = Math.max(...vals);
    let hImplicit = 0;
    let over = false;
    if (a.hExplicit !== null) {
      hImplicit = a.hExplicit;
      over = bondSum + hImplicit > maxVal;
    } else {
      const target = vals.find((v) => v >= bondSum);
      if (target === undefined) over = true;
      else hImplicit = target - bondSum;
    }
    a.hTotal = hImplicit + a.hFolded;
    a.hNodes = 0;
    a.degree = adj[i].length;
    a.overValence = over;
    a.ringCount = 0;
    a.ringSizes = new Set();
    a.aromatic = false;
    if (over) {
      problems.push({
        atomId: a.id,
        message: `${a.el}${a.charge ? (a.charge > 0 ? '+' : '−') : ''} has ${bondSum} bonds but allows at most ${maxVal}`,
      });
    }
  });

  // 3. Rings.
  const rings = findSSSR(atoms.length, bonds, adj).map((r) => ({ ...r, size: r.atoms.length, aromatic: false }));
  for (const r of rings) {
    for (const ai of r.atoms) { atoms[ai].ringCount++; atoms[ai].ringSizes.add(r.size); }
    for (const bi of r.bonds) bonds[bi].inRing = true;
  }

  const g = { atoms, bonds, adj, rings, notes, problems, index };
  perceiveAromaticity(g);
  return g;
}

// A nitro group drawn as N(=O)=O is re-expressed in its charge-separated form
// ([N+](=O)[O-]) so users are not punished for the common textbook drawing.
function normaliseNitro(atoms, bonds, notes) {
  const deg = new Array(atoms.length).fill(0);
  for (const b of bonds) { deg[b.a]++; deg[b.b]++; }
  const terminalO = (oi) => atoms[oi].z === 8 && atoms[oi].charge === 0 && deg[oi] === 1;
  atoms.forEach((n, ni) => {
    if (n.z !== 7 || n.charge !== 0) return;
    const dbl = bonds.filter((b) => (b.a === ni || b.b === ni) && b.order === 2 && terminalO(b.a === ni ? b.b : b.a));
    if (dbl.length !== 2) return;
    n.charge = 1;
    dbl[1].order = 1;
    atoms[dbl[1].a === ni ? dbl[1].b : dbl[1].a].charge = -1;
    notes.push('Nitro group interpreted in charge-separated form');
  });
}

// Aromaticity follows RDKit's default model: every ring atom gets a fixed
// number of π electrons it can donate, single rings are tested with Hückel's
// 4n+2 rule, then combinations of fused rings (the perimeter becomes aromatic,
// shared fusion bonds do not unless an individual ring already is).
const EN = { 1: 2.2, 5: 2.04, 6: 2.55, 7: 3.04, 8: 3.44, 9: 3.98, 14: 1.9, 15: 2.19, 16: 2.58, 17: 3.16, 33: 2.18, 34: 2.55, 35: 2.96, 52: 2.1, 53: 2.66 };
const DEFAULT_VALENCE = { 5: 3, 6: 4, 7: 3, 8: 2, 15: 3, 16: 2, 33: 3, 34: 2, 52: 2 };
const OUTER_ELECTRONS = { 5: 3, 6: 4, 7: 5, 8: 6, 15: 5, 16: 6, 33: 5, 34: 6, 52: 6 };
const MAX_FUSED_COMBINATION = 6;

// Electrons atom i can donate to a π system; -1 if it cannot be aromatic.
function donorElectrons(g, i) {
  const a = g.atoms[i];
  const dv = DEFAULT_VALENCE[a.z];
  if (!a.ringCount || dv === undefined) return -1;
  const degree = a.degree + a.hTotal;
  if (degree > 3) return -1;
  let bondSum = 0;
  let nMultiple = 0;
  let cyclicMultiple = false;
  let acyclicPartner = -1;
  for (const { nbr, bond } of g.adj[i]) {
    const b = g.bonds[bond];
    bondSum += b.order;
    if (b.order < 2) continue;
    nMultiple++;
    if (b.inRing) cyclicMultiple = true;
    else acyclicPartner = nbr;
  }
  const unsaturation = bondSum - a.degree;
  if (unsaturation > 1 && nMultiple > 1) return -1;
  const lonePairElectrons = Math.max(OUTER_ELECTRONS[a.z] - dv - a.charge, 0);
  let nelec = dv - degree + lonePairElectrons;
  if (nelec > 1 && unsaturation > 1) nelec = 1;
  if (nelec < 0) return -1;
  if (nelec === 0) {
    if (acyclicPartner >= 0) return 0;
    return cyclicMultiple ? 1 : -1;
  }
  if (nelec === 1) {
    // An exocyclic double bond to a more electronegative atom (C=O, C=N)
    // takes the electron out of the ring.
    if (acyclicPartner >= 0) return (EN[g.atoms[acyclicPartner].z] ?? 0) > EN[a.z] ? 0 : 1;
    if (nMultiple) return 1;
    return a.charge === 1 ? 0 : -1;
  }
  return nMultiple ? 1 : 2;
}

function combinations(items, k, visit) {
  const pick = [];
  const rec = (start) => {
    if (pick.length === k) { visit(pick); return; }
    for (let i = start; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
}

function perceiveAromaticity(g) {
  if (!g.rings.length) return;
  const electrons = g.atoms.map((_, i) => donorElectrons(g, i));
  const huckel = (atomSet) => {
    let e = 0;
    for (const a of atomSet) {
      if (electrons[a] < 0) return false;
      e += electrons[a];
    }
    return e >= 2 && (e - 2) % 4 === 0;
  };
  const ringBondSets = g.rings.map((r) => new Set(r.bonds));
  const fusedWith = g.rings.map((r, i) => g.rings.map((_, j) => j)
    .filter((j) => j !== i && r.bonds.some((b) => ringBondSets[j].has(b))));
  const aromaticBonds = new Set();
  const aromaticAtoms = new Set();

  // Fused ring systems = connected components of the ring-sharing-bond graph.
  const seen = new Uint8Array(g.rings.length);
  for (let s = 0; s < g.rings.length; s++) {
    if (seen[s]) continue;
    const system = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const r = stack.pop();
      system.push(r);
      for (const q of fusedWith[r]) if (!seen[q]) { seen[q] = 1; stack.push(q); }
    }
    const systemAtoms = new Set(system.flatMap((r) => g.rings[r].atoms));

    for (const ri of system) {
      if (!huckel(g.rings[ri].atoms)) continue;
      for (const a of g.rings[ri].atoms) aromaticAtoms.add(a);
      for (const b of g.rings[ri].bonds) aromaticBonds.add(b);
    }
    const done = () => [...systemAtoms].every((a) => aromaticAtoms.has(a));
    for (let k = 2; k <= Math.min(system.length, MAX_FUSED_COMBINATION) && !done(); k++) {
      combinations(system, k, (combo) => {
        // The chosen rings must form one fused (bond-connected) unit.
        const inCombo = new Set(combo);
        const reach = new Set([combo[0]]);
        const st = [combo[0]];
        while (st.length) for (const q of fusedWith[st.pop()]) if (inCombo.has(q) && !reach.has(q)) { reach.add(q); st.push(q); }
        if (reach.size !== combo.length) return;
        const union = new Set(combo.flatMap((r) => g.rings[r].atoms));
        if (!huckel(union)) return;
        const uses = new Map();
        for (const r of combo) for (const b of g.rings[r].bonds) uses.set(b, (uses.get(b) || 0) + 1);
        for (const a of union) aromaticAtoms.add(a);
        for (const [b, c] of uses) if (c === 1) aromaticBonds.add(b);
      });
    }
  }

  for (const a of aromaticAtoms) g.atoms[a].aromatic = true;
  for (const b of aromaticBonds) g.bonds[b].aromatic = true;
  for (const r of g.rings) r.aromatic = r.bonds.every((b) => aromaticBonds.has(b));
}

/** Copy of a perceived graph with every hydrogen as an explicit node. */
export function withExplicitHydrogens(g) {
  const atoms = g.atoms.map((a) => ({ ...a }));
  const bonds = g.bonds.map((b) => ({ ...b }));
  const adj = g.adj.map((list) => list.map((e) => ({ ...e })));
  const heavy = atoms.length;
  for (let i = 0; i < heavy; i++) {
    for (let k = 0; k < g.atoms[i].hTotal; k++) {
      const h = atoms.length;
      atoms.push({
        id: null, el: 'H', z: 1, charge: 0, hTotal: 0, hNodes: 0, degree: 1,
        aromatic: false, ringCount: 0, ringSizes: new Set(), parent: i,
      });
      const bi = bonds.length;
      bonds.push({ a: i, b: h, order: 1, aromatic: false, inRing: false });
      adj[i].push({ nbr: h, bond: bi });
      adj.push([{ nbr: i, bond: bi }]);
      atoms[i].degree += 1;
      atoms[i].hNodes += 1;
    }
  }
  return { atoms, bonds, adj, rings: g.rings, heavyCount: heavy };
}
