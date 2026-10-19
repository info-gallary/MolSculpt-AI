// Ring perception: symmetrized Smallest Set of Smallest Rings (SSSR).
// Candidates are Horton cycles (shortest-path tree from every atom closed by
// one bond); an independent subset is chosen greedily by size with Gaussian
// elimination over GF(2) on bond-incidence vectors. As in RDKit, rings that
// were dropped only because an equally small symmetric ring was chosen first
// (quinuclidine, cubane, adamantane) are added back.

function countComponents(n, adj) {
  const seen = new Uint8Array(n);
  let c = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    c++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const u = stack.pop();
      for (const { nbr } of adj[u]) if (!seen[nbr]) { seen[nbr] = 1; stack.push(nbr); }
    }
  }
  return c;
}

const highBit = (v) => v.toString(2).length - 1;

function reduce(v, basis) {
  while (v !== 0n) {
    const row = basis.get(highBit(v));
    if (!row) break;
    v ^= row;
  }
  return v;
}

function hortonCandidates(nAtoms, bonds, adj) {
  const candidates = new Map();
  const dist = new Int32Array(nAtoms);
  const parent = new Int32Array(nAtoms);
  const parentBond = new Int32Array(nAtoms);
  for (let r = 0; r < nAtoms; r++) {
    if (adj[r].length < 2) continue;
    dist.fill(-1);
    dist[r] = 0;
    parent[r] = -1;
    parentBond[r] = -1;
    const queue = [r];
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const { nbr, bond } of adj[u]) {
        if (dist[nbr] >= 0) continue;
        dist[nbr] = dist[u] + 1;
        parent[nbr] = u;
        parentBond[nbr] = bond;
        queue.push(nbr);
      }
    }
    const path = (x) => {
      const atoms = [];
      const bs = [];
      for (let c = x; c !== -1; c = parent[c]) {
        atoms.push(c);
        if (parentBond[c] >= 0) bs.push(parentBond[c]);
      }
      return { atoms: atoms.reverse(), bonds: bs };
    };
    bonds.forEach((bd, bi) => {
      const { a: x, b: y } = bd;
      if (dist[x] < 0 || dist[y] < 0 || parentBond[x] === bi || parentBond[y] === bi) return;
      const px = path(x);
      const py = path(y);
      const onX = new Set(px.atoms);
      for (let k = 1; k < py.atoms.length; k++) if (onX.has(py.atoms[k])) return;
      const ringBonds = [...px.bonds, bi, ...py.bonds];
      const key = [...ringBonds].sort((p, q) => p - q).join(',');
      if (candidates.has(key)) return;
      candidates.set(key, { atoms: [...px.atoms, ...py.atoms.slice(1).reverse()], bonds: ringBonds });
    });
  }
  return [...candidates.values()];
}

/**
 * @returns {{atoms:number[], bonds:number[]}[]} rings with atoms in cyclic order
 */
export function findSSSR(nAtoms, bonds, adj) {
  const nRings = bonds.length - nAtoms + countComponents(nAtoms, adj);
  if (nRings <= 0) return [];

  const sorted = hortonCandidates(nAtoms, bonds, adj).sort((p, q) => p.bonds.length - q.bonds.length);
  const vec = (cyc) => cyc.bonds.reduce((v, b) => v | (1n << BigInt(b)), 0n);
  const basis = new Map();
  const rings = [];
  const rejected = [];
  for (const cyc of sorted) {
    if (rings.length === nRings) { rejected.push(cyc); continue; }
    const v = reduce(vec(cyc), basis);
    if (v === 0n) { rejected.push(cyc); continue; }
    basis.set(highBit(v), v);
    rings.push(cyc);
  }

  // Symmetrization: a dropped ring that is a GF(2) sum of chosen rings of the
  // very same size is an equally valid "smallest" ring and is kept as well.
  const extra = [];
  const bySize = new Map();
  for (const r of rings) {
    if (!bySize.has(r.bonds.length)) bySize.set(r.bonds.length, []);
    bySize.get(r.bonds.length).push(r);
  }
  for (const cyc of rejected) {
    const same = bySize.get(cyc.bonds.length);
    if (!same || same.length < 2) continue;
    const local = new Map();
    for (const r of same) {
      const v = reduce(vec(r), local);
      if (v !== 0n) local.set(highBit(v), v);
    }
    if (reduce(vec(cyc), local) === 0n) extra.push(cyc);
  }
  return [...rings, ...extra];
}
