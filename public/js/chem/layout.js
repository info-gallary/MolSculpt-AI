// 2D depiction for molecules that arrive without coordinates (SMILES import,
// AI-suggested analogues). Rings are placed as regular polygons fused edge-to-
// edge, substituents are distributed into the largest free angular gap and
// chains zig-zag at 120°. A short relaxation pass removes atom collisions.

import { findSSSR } from './rings.js';

const TAU = Math.PI * 2;

export function layoutMolecule(mol, { bondLength = 56, center = { x: 0, y: 0 } } = {}) {
  const ids = [...mol.atoms.keys()];
  const n = ids.length;
  if (!n) return mol;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const bonds = [...mol.bonds.values()].map((b) => ({ a: idx.get(b.a), b: idx.get(b.b), order: b.order }));
  const adj = ids.map(() => []);
  bonds.forEach((b, bi) => {
    adj[b.a].push({ nbr: b.b, bond: bi });
    adj[b.b].push({ nbr: b.a, bond: bi });
  });
  const rings = findSSSR(n, bonds, adj).map((r) => r.atoms);
  const ringsOf = ids.map(() => []);
  rings.forEach((r, ri) => r.forEach((a) => ringsOf[a].push(ri)));
  const ringDone = new Array(rings.length).fill(false);
  const L = bondLength;
  const pos = new Array(n).fill(null);
  const zig = new Array(n).fill(1);

  const centroid = (list) => {
    const pts = list.filter((i) => pos[i]);
    if (!pts.length) return null;
    return { x: pts.reduce((s, i) => s + pos[i].x, 0) / pts.length, y: pts.reduce((s, i) => s + pos[i].y, 0) / pts.length };
  };
  const angle = (from, to) => Math.atan2(pos[to].y - pos[from].y, pos[to].x - pos[from].x);
  const put = (i, x, y) => { pos[i] = { x, y }; };

  function awayDirection(i, exclude = new Set()) {
    let vx = 0, vy = 0;
    for (const { nbr } of adj[i]) {
      if (!pos[nbr] || exclude.has(nbr)) continue;
      const a = angle(i, nbr);
      vx -= Math.cos(a); vy -= Math.sin(a);
    }
    if (Math.hypot(vx, vy) < 1e-6) return -Math.PI / 2;
    return Math.atan2(vy, vx);
  }

  function placeRing(ri, origin) {
    const ring = rings[ri];
    const m = ring.length;
    const R = L / (2 * Math.sin(Math.PI / m));
    const placed = ring.map((a) => !!pos[a]);
    const k = placed.filter(Boolean).length;
    ringDone[ri] = true;
    if (k === m) return;

    if (k === 0) {
      const o = origin ?? { x: 0, y: 0 };
      const off = Math.PI / 2 + Math.PI / m;
      ring.forEach((a, j) => put(a, o.x + R * Math.cos(off + (TAU * j) / m), o.y + R * Math.sin(off + (TAU * j) / m)));
      return;
    }

    if (k === 1) {
      const j0 = placed.indexOf(true);
      const p = ring[j0];
      const dir = awayDirection(p, new Set(ring));
      const c = { x: pos[p].x + R * Math.cos(dir), y: pos[p].y + R * Math.sin(dir) };
      const a0 = dir + Math.PI;
      for (let s = 1; s < m; s++) {
        const a = ring[(j0 + s) % m];
        if (!pos[a]) put(a, c.x + R * Math.cos(a0 + (TAU * s) / m), c.y + R * Math.sin(a0 + (TAU * s) / m));
      }
      return;
    }

    // Longest contiguous run of placed atoms (cyclic), rotated to start at 0.
    let bestStart = 0, bestLen = 0;
    for (let s = 0; s < m; s++) {
      if (!placed[s] || placed[(s - 1 + m) % m]) continue;
      let len = 0;
      while (len < m && placed[(s + len) % m]) len++;
      if (len > bestLen) { bestLen = len; bestStart = s; }
    }
    if (bestLen === 0) { bestStart = placed.indexOf(true); bestLen = 1; }
    const order = ring.map((_, j) => ring[(bestStart + j) % m]);
    const A = order[0], B = order[bestLen - 1];
    const unplaced = order.slice(bestLen).filter((a) => !pos[a]);
    const pa = pos[A], pb = pos[B];
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y) || L;
    let nx = -(pb.y - pa.y) / d, ny = (pb.x - pa.x) / d;
    const near = new Set(order.slice(0, bestLen));
    const refList = [];
    for (const q of near) for (const { nbr } of adj[q]) if (pos[nbr] && !near.has(nbr)) refList.push(nbr);
    for (const q of near) refList.push(q);
    const ref = centroid(refList) ?? mid;
    if (nx * (ref.x - mid.x) + ny * (ref.y - mid.y) > 0) { nx = -nx; ny = -ny; }
    const h = Math.sqrt(Math.max(R * R - (d / 2) * (d / 2), 0));
    const c = { x: mid.x + nx * h, y: mid.y + ny * h };
    const tA = Math.atan2(pa.y - c.y, pa.x - c.x);
    const tB = Math.atan2(pb.y - c.y, pb.x - c.x);
    let short = tA - tB;
    while (short > Math.PI) short -= TAU;
    while (short <= -Math.PI) short += TAU;
    const far = short - Math.sign(short || 1) * TAU;
    unplaced.forEach((a, j) => {
      const t = tB + (far * (j + 1)) / (unplaced.length + 1);
      put(a, c.x + R * Math.cos(t), c.y + R * Math.sin(t));
    });
  }

  function placeRingSystemFrom(seedRing, origin) {
    placeRing(seedRing, origin);
    for (;;) {
      let best = -1, bestScore = 0;
      rings.forEach((r, ri) => {
        if (ringDone[ri]) return;
        const k = r.filter((a) => pos[a]).length;
        if (k > bestScore) { bestScore = k; best = ri; }
      });
      if (best < 0) break;
      placeRing(best);
    }
  }

  function placeNeighbours(u) {
    const placedN = adj[u].filter((e) => pos[e.nbr]);
    const free = adj[u].filter((e) => !pos[e.nbr]);
    if (!free.length) return [];
    let dirs;
    const angs = placedN.map((e) => angle(u, e.nbr));
    const linear = adj[u].some((e) => bonds[e.bond].order === 3)
      || adj[u].filter((e) => bonds[e.bond].order === 2).length === 2;
    if (!angs.length) {
      dirs = free.map((_, j) => -Math.PI / 6 + (TAU * j) / free.length);
    } else if (angs.length === 1) {
      const base = angs[0];
      if (free.length === 1) dirs = [linear ? base + Math.PI : base + zig[u] * (TAU / 3)];
      else if (free.length === 2) dirs = [base + TAU / 3, base - TAU / 3];
      else dirs = free.map((_, j) => base + (TAU * (j + 1)) / (free.length + 1));
    } else {
      const sorted = [...angs].map((a) => (a + TAU) % TAU).sort((x, y) => x - y);
      let gapStart = sorted[sorted.length - 1], gap = sorted[0] + TAU - sorted[sorted.length - 1];
      for (let j = 1; j < sorted.length; j++) {
        if (sorted[j] - sorted[j - 1] > gap) { gap = sorted[j] - sorted[j - 1]; gapStart = sorted[j - 1]; }
      }
      dirs = free.map((_, j) => gapStart + (gap * (j + 1)) / (free.length + 1));
    }
    const out = [];
    free.forEach((e, j) => {
      put(e.nbr, pos[u].x + L * Math.cos(dirs[j]), pos[u].y + L * Math.sin(dirs[j]));
      zig[e.nbr] = -zig[u];
      out.push(e.nbr);
      const rr = ringsOf[e.nbr].find((ri) => !ringDone[ri]);
      if (rr !== undefined) {
        const before = new Set(pos.map((p, i) => (p ? i : -1)).filter((i) => i >= 0));
        placeRingSystemFrom(rr);
        pos.forEach((p, i) => { if (p && !before.has(i)) out.push(i); });
      }
    });
    return out;
  }

  // Connected components, laid out one after another.
  const seen = new Uint8Array(n);
  const components = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const comp = [];
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const u = st.pop();
      comp.push(u);
      for (const { nbr } of adj[u]) if (!seen[nbr]) { seen[nbr] = 1; st.push(nbr); }
    }
    components.push(comp);
  }

  let offsetX = 0;
  for (const comp of components) {
    const inComp = new Set(comp);
    const compRings = rings.map((r, ri) => ri).filter((ri) => inComp.has(rings[ri][0]));
    let queue;
    if (compRings.length) {
      // Seed with the ring that has the most fused neighbours.
      const fused = (ri) => compRings.filter((rj) => rj !== ri && rings[rj].some((a) => rings[ri].includes(a))).length;
      const seed = compRings.reduce((b, ri) => (fused(ri) > fused(b) ? ri : b), compRings[0]);
      placeRingSystemFrom(seed, { x: 0, y: 0 });
      queue = comp.filter((i) => pos[i]);
    } else {
      // Start a chain at one end of its longest path.
      const far = (src) => {
        const dist = new Map([[src, 0]]);
        const q = [src];
        for (let qi = 0; qi < q.length; qi++) for (const { nbr } of adj[q[qi]]) if (!dist.has(nbr)) { dist.set(nbr, dist.get(q[qi]) + 1); q.push(nbr); }
        return q[q.length - 1];
      };
      const start = far(far(comp[0]));
      put(start, 0, 0);
      queue = [start];
    }
    for (let qi = 0; qi < queue.length; qi++) queue.push(...placeNeighbours(queue[qi]));

    // Shift component to the right of the previous one.
    const xs = comp.map((i) => pos[i].x);
    const minX = Math.min(...xs);
    const shift = offsetX - minX;
    comp.forEach((i) => { pos[i].x += shift; });
    offsetX = Math.max(...comp.map((i) => pos[i].x)) + L * 1.5;
  }

  relax(pos, bonds, L);

  const cx = pos.reduce((s, p) => s + p.x, 0) / n;
  const cy = pos.reduce((s, p) => s + p.y, 0) / n;
  ids.forEach((id, i) => {
    const a = mol.atoms.get(id);
    a.x = pos[i].x - cx + center.x;
    a.y = pos[i].y - cy + center.y;
  });
  return mol;
}

// Push apart atoms that ended up too close while keeping bond lengths.
function relax(pos, bonds, L) {
  const n = pos.length;
  const bonded = new Set(bonds.map((b) => `${Math.min(b.a, b.b)}-${Math.max(b.a, b.b)}`));
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (bonded.has(`${i}-${j}`)) continue;
        const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= 0.7 * L) continue;
        const push = ((0.7 * L - d) / 2) * 0.5;
        const ux = dx / d, uy = dy / d;
        pos[i].x -= ux * push; pos[i].y -= uy * push;
        pos[j].x += ux * push; pos[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
    for (const b of bonds) {
      const p = pos[b.a], q = pos[b.b];
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const k = ((d - L) / d) * 0.25;
      p.x += dx * k; p.y += dy * k;
      q.x -= dx * k; q.y -= dy * k;
    }
  }
}
