// SMILES reader (organic subset, bracket atoms, branches, ring closures,
// aromatic lower-case atoms with kekulization) and a deterministic writer.

import { Molecule } from './molecule.js';
import { ELEMENTS, ORGANIC_SUBSET, AROMATIC_SYMBOLS, allowedValences } from './elements.js';
import { findSSSR } from './rings.js';

export class SmilesError extends Error {}

const BRACKET_RE = /^(\d+)?([A-Z][a-z]?|se|as|[bcnops]|\*)(@{1,2}(?:TH[12]|AL[12]|SP[123]|TB\d{1,2}|OH\d{1,2})?)?(H\d*)?([+-]{1,4}|[+-]\d+)?(:\d+)?$/;

function parseBracket(text) {
  const m = BRACKET_RE.exec(text);
  if (!m) throw new SmilesError(`Cannot read bracket atom [${text}]`);
  let sym = m[2];
  let aromatic = false;
  if (AROMATIC_SYMBOLS[sym]) { aromatic = true; sym = AROMATIC_SYMBOLS[sym]; }
  if (!ELEMENTS[sym]) throw new SmilesError(`Element ${sym} is not supported`);
  const h = m[4] ? (m[4].length > 1 ? parseInt(m[4].slice(1), 10) : 1) : 0;
  let charge = 0;
  if (m[5]) {
    const sign = m[5][0] === '+' ? 1 : -1;
    charge = /\d/.test(m[5]) ? sign * parseInt(m[5].slice(1), 10) : sign * m[5].length;
  }
  return { el: sym, aromatic, charge, hExplicit: h, bracket: true };
}

/** Parse a SMILES string into a Molecule (coordinates all zero). */
export function parseSmiles(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new SmilesError('Empty SMILES');
  if (s.length > 2000) throw new SmilesError('SMILES too long');

  const atoms = [];
  const bonds = [];
  const stack = [];
  const ringOpen = new Map();
  let prev = -1;
  let pending = null;
  let i = 0;

  const addBond = (a, b, sym) => {
    if (a === b || bonds.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) {
      throw new SmilesError('Invalid ring closure (duplicate bond)');
    }
    let order;
    if (sym === '=') order = 2;
    else if (sym === '#') order = 3;
    else if (sym === ':') order = 'ar';
    else if (sym === '-' || sym === '/' || sym === '\\') order = 1;
    else order = atoms[a].aromatic && atoms[b].aromatic ? 'ar' : 1;
    bonds.push({ a, b, order });
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '(') {
      if (prev < 0) throw new SmilesError(`Branch without atom at position ${i + 1}`);
      stack.push(prev); i++; continue;
    }
    if (c === ')') {
      if (!stack.length) throw new SmilesError(`Unmatched ')' at position ${i + 1}`);
      prev = stack.pop(); i++; continue;
    }
    if ('-=#:/\\'.includes(c)) { pending = c; i++; continue; }
    if (c === '.') { prev = -1; pending = null; i++; continue; }
    if (/\d/.test(c) || c === '%') {
      let num;
      if (c === '%') { num = s.substr(i + 1, 2); i += 3; } else { num = c; i++; }
      if (prev < 0) throw new SmilesError('Ring closure without atom');
      if (ringOpen.has(num)) {
        const r = ringOpen.get(num);
        ringOpen.delete(num);
        addBond(r.atom, prev, pending ?? r.bond);
      } else {
        ringOpen.set(num, { atom: prev, bond: pending });
      }
      pending = null;
      continue;
    }

    let atom;
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new SmilesError('Unclosed bracket atom');
      atom = parseBracket(s.slice(i + 1, end));
      i = end + 1;
    } else {
      const two = s.substr(i, 2);
      if (two === 'Cl' || two === 'Br') { atom = { el: two, aromatic: false }; i += 2; }
      else if (ORGANIC_SUBSET.has(c)) { atom = { el: c, aromatic: false }; i++; }
      else if (AROMATIC_SYMBOLS[c] && c.length === 1) { atom = { el: AROMATIC_SYMBOLS[c], aromatic: true }; i++; }
      else throw new SmilesError(`Unexpected character '${c}' at position ${i + 1}`);
      Object.assign(atom, { charge: 0, hExplicit: null, bracket: false });
    }
    const idx = atoms.length;
    atoms.push(atom);
    if (prev >= 0) addBond(prev, idx, pending);
    pending = null;
    prev = idx;
  }
  if (ringOpen.size) throw new SmilesError('Unclosed ring bond');
  if (stack.length) throw new SmilesError("Unclosed branch '('");

  // Aromatic N-oxides written as n=O are read as [n+][O-] (as RDKit does).
  for (const b of bonds) {
    if (b.order !== 2) continue;
    for (const [n, o] of [[b.a, b.b], [b.b, b.a]]) {
      const terminalO = atoms[o].el === 'O' && atoms[o].charge === 0 && bonds.filter((x) => x.a === o || x.b === o).length === 1;
      if (atoms[n].el === 'N' && atoms[n].aromatic && atoms[n].charge === 0 && terminalO) {
        atoms[n].charge = 1;
        atoms[o].charge = -1;
        b.order = 1;
        break;
      }
    }
  }

  kekulize(atoms, bonds);

  const mol = new Molecule();
  const ids = atoms.map((a) => mol.addAtom(a.el, 0, 0, { charge: a.charge, hExplicit: a.hExplicit }).id);
  for (const b of bonds) mol.addBond(ids[b.a], ids[b.b], b.order);
  return mol;
}

// Assign alternating single/double bonds to aromatic systems.
function kekulize(atoms, bonds) {
  if (!bonds.some((b) => b.order === 'ar')) return;
  const n = atoms.length;
  const adj = atoms.map(() => []);
  bonds.forEach((b, bi) => { adj[b.a].push({ nbr: b.b, bond: bi }); adj[b.b].push({ nbr: b.a, bond: bi }); });
  const inRing = new Set(findSSSR(n, bonds, adj).flatMap((r) => r.bonds));
  bonds.forEach((b, bi) => { if (b.order === 'ar' && !inRing.has(bi)) b.order = 1; });

  const needs = (lenient) => atoms.map((a, i) => {
    if (!a.aromatic) return 0;
    if (!adj[i].some((e) => bonds[e.bond].order === 'ar')) return 0;
    if (adj[i].some((e) => bonds[e.bond].order === 2)) return 0;
    const deg = adj[i].length;
    const h = a.hExplicit ?? 0;
    switch (a.el) {
      case 'C': return a.charge === 0 ? 1 : 0;
      case 'N': case 'P':
        if (a.charge === 1) return 1;
        if (a.charge === 0 && h === 0 && deg === 2) return lenient && !a.bracket ? 2 : 1;
        return 0;
      case 'O': case 'S': case 'Se': return a.charge === 1 ? 1 : 0;
      default: return 0;
    }
  });

  const solve = (need) => {
    const matched = new Array(n).fill(-1);
    const required = [];
    for (let i = 0; i < n; i++) if (need[i] === 1) required.push(i);
    const options = (i) => adj[i].filter((e) => bonds[e.bond].order === 'ar' && need[e.nbr] && matched[e.nbr] < 0);
    const rec = () => {
      let best = -1;
      let bestOpts = null;
      for (const i of required) {
        if (matched[i] >= 0) continue;
        const o = options(i);
        if (!o.length) return false;
        if (!bestOpts || o.length < bestOpts.length) { best = i; bestOpts = o; }
      }
      if (best < 0) return true;
      for (const e of bestOpts) {
        matched[best] = e.bond; matched[e.nbr] = e.bond;
        if (rec()) return true;
        matched[best] = -1; matched[e.nbr] = -1;
      }
      return false;
    };
    return rec() ? matched : null;
  };

  const matched = solve(needs(false)) ?? solve(needs(true));
  if (!matched) throw new SmilesError('Cannot kekulize aromatic ring (missing [nH]?)');
  bonds.forEach((b) => { if (b.order === 'ar') b.order = 1; });
  matched.forEach((bi) => { if (bi >= 0) bonds[bi].order = 2; });
}

// ---------------------------------------------------------------- writer

const cmpArr = (p, q) => {
  for (let k = 0; k < Math.min(p.length, q.length); k++) if (p[k] !== q[k]) return p[k] - q[k];
  return p.length - q.length;
};

function denseRanks(keys) {
  const idx = keys.map((_, i) => i).sort((p, q) => cmpArr(keys[p], keys[q]));
  const ranks = new Array(keys.length);
  let r = 0;
  idx.forEach((i, k) => {
    if (k > 0 && cmpArr(keys[idx[k - 1]], keys[i]) !== 0) r++;
    ranks[i] = r;
  });
  return ranks;
}

const bondCode = (b) => (b.aromatic ? 4 : b.order);

/** Morgan-style canonical ranks; ties broken by atom index. */
export function canonicalRanks(g) {
  const n = g.atoms.length;
  let ranks = denseRanks(g.atoms.map((a) => [a.z, a.degree, a.hTotal, a.charge, a.aromatic ? 1 : 0, a.ringCount]));
  let distinct = new Set(ranks).size;
  for (let it = 0; it < n; it++) {
    const keys = g.atoms.map((_, i) => [ranks[i], ...g.adj[i].map((e) => ranks[e.nbr] * 8 + bondCode(g.bonds[e.bond])).sort((x, y) => x - y)]);
    const next = denseRanks(keys);
    const d = new Set(next).size;
    ranks = next;
    if (d === distinct) break;
    distinct = d;
  }
  return denseRanks(ranks.map((r, i) => [r, i]));
}

function impliedHydrogens(g, i) {
  const a = g.atoms[i];
  if (a.aromatic) {
    if (a.el === 'C') return Math.max(0, 3 - a.degree);
    return 0;
  }
  const sum = g.adj[i].reduce((s, e) => s + g.bonds[e.bond].order, 0);
  const v = allowedValences(a.z, 0).find((x) => x >= sum);
  return v === undefined ? 0 : v - sum;
}

function atomToken(g, i) {
  const a = g.atoms[i];
  const sym = a.aromatic ? (a.el === 'Se' ? 'se' : a.el.toLowerCase()) : a.el;
  const bare = ORGANIC_SUBSET.has(a.el) && a.charge === 0 && impliedHydrogens(g, i) === a.hTotal;
  if (bare) return sym;
  let t = `[${sym}`;
  if (a.hTotal) t += a.hTotal > 1 ? `H${a.hTotal}` : 'H';
  if (a.charge) t += (a.charge > 0 ? '+' : '-') + (Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '');
  return `${t}]`;
}

function bondToken(g, bi) {
  const b = g.bonds[bi];
  if (b.aromatic) return '';
  if (b.order === 2) return '=';
  if (b.order === 3) return '#';
  return g.atoms[b.a].aromatic && g.atoms[b.b].aromatic ? '-' : '';
}

/** Write SMILES for a perceived graph (aromatic lower-case form). */
export function writeSmiles(g) {
  const n = g.atoms.length;
  if (!n) return '';
  const rank = canonicalRanks(g);
  const visited = new Uint8Array(n);
  const parts = [];

  for (;;) {
    let start = -1;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      if (start < 0) { start = i; continue; }
      const better = (g.atoms[i].degree <= 1) - (g.atoms[start].degree <= 1);
      if (better > 0 || (better === 0 && rank[i] < rank[start])) start = i;
    }
    if (start < 0) break;

    // Pass 1: DFS spanning tree, collecting ring-closure bonds.
    const children = new Map();
    const closures = new Map(); // atom -> [{bond, other}]
    const seenBond = new Set();
    const dfs = (u, fromBond) => {
      visited[u] = 1;
      children.set(u, []);
      // Terminal atoms first so short substituents become branches: CC(=O)O.
      const terminal = (e) => (g.atoms[e.nbr].degree === 1 ? 0 : 1);
      const nbrs = g.adj[u].filter((e) => e.bond !== fromBond)
        .sort((p, q) => terminal(p) - terminal(q) || rank[p.nbr] - rank[q.nbr]);
      for (const e of nbrs) {
        if (seenBond.has(e.bond)) continue;
        seenBond.add(e.bond);
        if (visited[e.nbr]) {
          if (!closures.has(u)) closures.set(u, []);
          if (!closures.has(e.nbr)) closures.set(e.nbr, []);
          closures.get(e.nbr).push({ bond: e.bond, open: true });
          closures.get(u).push({ bond: e.bond, open: false });
        } else {
          children.get(u).push(e);
          dfs(e.nbr, e.bond);
        }
      }
    };
    dfs(start, -1);

    // Pass 2: emit symbols, ring digits and branches.
    const digitOf = new Map();
    const free = [];
    let nextDigit = 1;
    const takeDigit = () => (free.length ? free.sort((x, y) => x - y).shift() : nextDigit++);
    const digitText = (d) => (d < 10 ? String(d) : `%${d}`);
    let out = '';
    const emit = (u, viaBond) => {
      if (viaBond >= 0) out += bondToken(g, viaBond);
      out += atomToken(g, u);
      const released = [];
      for (const c of closures.get(u) ?? []) {
        if (c.open) {
          const d = takeDigit();
          digitOf.set(c.bond, d);
          out += digitText(d);
        } else {
          const d = digitOf.get(c.bond);
          out += bondToken(g, c.bond) + digitText(d);
          released.push(d);
        }
      }
      free.push(...released);
      const kids = children.get(u);
      kids.forEach((e, k) => {
        if (k < kids.length - 1) { out += '('; emit(e.nbr, e.bond); out += ')'; }
        else emit(e.nbr, e.bond);
      });
    };
    emit(start, -1);
    parts.push(out);
  }
  return parts.join('.');
}

// ------------------------------------------------------------ signature

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Weisfeiler–Lehman graph signature, invariant to atom order and to the
 * Kekulé form chosen by the user. Used to recognise a target molecule.
 */
export function graphSignature(g) {
  let labels = g.atoms.map((a) => `${a.el}${a.aromatic ? 'a' : ''}h${a.hTotal}q${a.charge}`);
  const rounds = Math.min(8, g.atoms.length);
  for (let r = 0; r < rounds; r++) {
    labels = g.atoms.map((_, i) => fnv1a(labels[i] + '|' + g.adj[i]
      .map((e) => bondCode(g.bonds[e.bond]) + labels[e.nbr]).sort().join(',')));
  }
  return fnv1a([...labels].sort().join(';') + `#${g.atoms.length}/${g.bonds.length}`);
}
