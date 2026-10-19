// A compact SMARTS engine covering the subset used by Crippen typing,
// functional-group perception and structural alerts:
//   atoms  : * a A #n element symbols (aliphatic/aromatic) D X H h R r v x +/- $()
//   logic  : ! & , ;  (and implicit high-precedence AND)
//   bonds  : - = # : ~ @ / \  with the same logic operators
//   syntax : branches ( ) and ring closures 0-9 / %nn
// Matching is backtracking subgraph isomorphism anchored on pattern atom 0.

const Z_OF = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10, Na: 11, Mg: 12, Al: 13,
  Si: 14, P: 15, S: 16, Cl: 17, Ar: 18, K: 19, Ca: 20, Fe: 26, Cu: 29, Zn: 30, Ga: 31,
  Ge: 32, As: 33, Se: 34, Br: 35, Rb: 37, Sr: 38, Ag: 47, Sn: 50, Sb: 51, Te: 52, I: 53,
  Cs: 55, Ba: 56, Pt: 78, Au: 79, Hg: 80, Pb: 82, Bi: 83,
};
const AROMATIC = { c: 6, n: 7, o: 8, s: 16, p: 15, b: 5, se: 34, as: 33 };
const ANY = { t: 'any' };
const DEFAULT_BOND = { t: 'default' };
const BOND_CHARS = '-=#:~@/\\';

let nextId = 1;
const cache = new Map();

export function compileSmarts(src) {
  let p = cache.get(src);
  if (!p) {
    p = new Parser(src).parsePattern();
    p.id = nextId++;
    p.src = src;
    cache.set(src, p);
  }
  return p;
}

class Parser {
  constructor(s) {
    this.s = s;
    this.i = 0;
  }

  peek(k = 0) { return this.s[this.i + k]; }

  fail(msg) { throw new Error(`SMARTS "${this.s}": ${msg} (pos ${this.i})`); }

  readNum(dflt) {
    const m = /^\d+/.exec(this.s.slice(this.i));
    if (!m) return dflt;
    this.i += m[0].length;
    return parseInt(m[0], 10);
  }

  parsePattern() {
    const atoms = [];
    const parent = [];
    const closures = [];
    const stack = [];
    const ringOpen = new Map();
    let prev = -1;
    let pending = null;
    while (this.i < this.s.length) {
      const c = this.peek();
      if (c === '(') { stack.push(prev); this.i++; continue; }
      if (c === ')') { prev = stack.pop(); this.i++; continue; }
      if (BOND_CHARS.includes(c) || c === '!') {
        this.kind = 'bond';
        pending = this.parseLow();
        continue;
      }
      if (/\d/.test(c) || c === '%') {
        let num;
        if (c === '%') { num = this.s.substr(this.i + 1, 2); this.i += 3; } else { num = c; this.i++; }
        if (ringOpen.has(num)) {
          const r = ringOpen.get(num);
          ringOpen.delete(num);
          closures[prev].push({ atom: r.atom, bond: pending ?? r.bond ?? DEFAULT_BOND });
        } else {
          ringOpen.set(num, { atom: prev, bond: pending });
        }
        pending = null;
        continue;
      }
      if (c === '.') this.fail('disconnected patterns are not supported');
      let expr;
      if (c === '[') {
        this.i++;
        this.kind = 'atom';
        expr = this.parseLow();
        if (this.peek() !== ']') this.fail("expected ']'");
        this.i++;
      } else {
        expr = this.parseBareAtom();
      }
      const k = atoms.length;
      atoms.push(expr);
      closures.push([]);
      parent.push(prev >= 0 ? { atom: prev, bond: pending ?? DEFAULT_BOND } : null);
      if (prev < 0 && k > 0) this.fail('disconnected pattern');
      pending = null;
      prev = k;
    }
    if (ringOpen.size) this.fail('unclosed ring');
    return { atoms, parent, closures };
  }

  parseBareAtom() {
    const c = this.peek();
    const two = this.s.substr(this.i, 2);
    if (two === 'Cl' || two === 'Br') { this.i += 2; return { t: 'el', z: Z_OF[two], ar: false }; }
    this.i++;
    if (c === '*') return ANY;
    if (c === 'a') return { t: 'arom' };
    if (c === 'A') return { t: 'aliph' };
    if ('BCNOPSFI'.includes(c)) return { t: 'el', z: Z_OF[c], ar: false };
    if (AROMATIC[c]) return { t: 'el', z: AROMATIC[c], ar: true };
    this.i--;
    return this.fail(`unexpected '${c}'`);
  }

  // Low-precedence AND (;) < OR (,) < high AND (& or adjacency) < NOT (!)
  parseLow() {
    const args = [this.parseOr()];
    while (this.peek() === ';') { this.i++; args.push(this.parseOr()); }
    return args.length === 1 ? args[0] : { t: 'and', args };
  }

  parseOr() {
    const args = [this.parseHigh()];
    while (this.peek() === ',') { this.i++; args.push(this.parseHigh()); }
    return args.length === 1 ? args[0] : { t: 'or', args };
  }

  parseHigh() {
    const args = [this.parseNot()];
    for (;;) {
      const c = this.peek();
      if (c === '&') { this.i++; args.push(this.parseNot()); continue; }
      if (c === undefined) break;
      if (this.kind === 'atom' ? !'];,)'.includes(c) : (BOND_CHARS.includes(c) || c === '!')) {
        args.push(this.parseNot());
        continue;
      }
      break;
    }
    return args.length === 1 ? args[0] : { t: 'and', args };
  }

  parseNot() {
    if (this.peek() === '!') { this.i++; return { t: 'not', arg: this.parseNot() }; }
    return this.kind === 'atom' ? this.parseAtomPrimitive() : this.parseBondPrimitive();
  }

  parseBondPrimitive() {
    const c = this.peek();
    this.i++;
    switch (c) {
      case '-': case '/': case '\\': return { t: 'single' };
      case '=': return { t: 'double' };
      case '#': return { t: 'triple' };
      case ':': return { t: 'arom' };
      case '~': return { t: 'any' };
      case '@': return { t: 'ring' };
      default: this.i--; return this.fail(`bad bond '${c}'`);
    }
  }

  parseAtomPrimitive() {
    const c = this.peek();
    if (c === '*') { this.i++; return ANY; }
    if (c === '$') {
      if (this.peek(1) !== '(') this.fail("expected '(' after $");
      let depth = 0;
      const start = this.i + 2;
      let j = this.i + 1;
      for (; j < this.s.length; j++) {
        if (this.s[j] === '(') depth++;
        else if (this.s[j] === ')') { depth--; if (depth === 0) break; }
      }
      if (depth !== 0) this.fail('unbalanced recursive SMARTS');
      const sub = this.s.slice(start, j);
      this.i = j + 1;
      return { t: 'rec', p: compileSmarts(sub) };
    }
    if (c === '#') { this.i++; return { t: 'z', v: this.readNum(0) }; }
    if (c === '+' || c === '-') {
      this.i++;
      const sign = c === '+' ? 1 : -1;
      let n = this.readNum(null);
      if (n === null) { n = 1; while (this.peek() === c) { n++; this.i++; } }
      return { t: 'chg', v: sign * n };
    }
    if (c === '@') { while (this.peek() === '@') this.i++; return ANY; }
    if (/\d/.test(c)) { this.readNum(0); return ANY; } // isotope: ignored
    const two = this.s.substr(this.i, 2);
    if (/^[A-Z][a-z]$/.test(two) && Z_OF[two]) { this.i += 2; return { t: 'el', z: Z_OF[two], ar: false }; }
    if (two === 'se' || two === 'as') { this.i += 2; return { t: 'el', z: AROMATIC[two], ar: true }; }
    this.i++;
    switch (c) {
      case 'D': return { t: 'D', v: this.readNum(1) };
      case 'X': return { t: 'X', v: this.readNum(1) };
      case 'H': return { t: 'H', v: this.readNum(1) };
      case 'h': return { t: 'h', v: this.readNum(null) };
      case 'R': return { t: 'R', v: this.readNum(null) };
      case 'r': return { t: 'r', v: this.readNum(null) };
      case 'v': return { t: 'v', v: this.readNum(1) };
      case 'x': return { t: 'x', v: this.readNum(null) };
      case 'a': return { t: 'arom' };
      case 'A': return { t: 'aliph' };
      default:
        if (AROMATIC[c]) return { t: 'el', z: AROMATIC[c], ar: true };
        if (Z_OF[c]) return { t: 'el', z: Z_OF[c], ar: false };
        this.i--;
        return this.fail(`unknown primitive '${c}'`);
    }
  }
}

// ---------------------------------------------------------------- matching

function atomOk(e, g, i) {
  const a = g.atoms[i];
  switch (e.t) {
    case 'any': return true;
    case 'and': for (const x of e.args) if (!atomOk(x, g, i)) return false; return true;
    case 'or': for (const x of e.args) if (atomOk(x, g, i)) return true; return false;
    case 'not': return !atomOk(e.arg, g, i);
    case 'z': return a.z === e.v;
    case 'el': return a.z === e.z && a.aromatic === e.ar;
    case 'arom': return a.aromatic;
    case 'aliph': return !a.aromatic;
    case 'chg': return a.charge === e.v;
    case 'D': return a.degree === e.v;
    case 'X': return a.degree + a.hTotal - a.hNodes === e.v;
    case 'H': return a.hTotal === e.v;
    case 'h': return e.v === null ? a.hTotal - a.hNodes > 0 : a.hTotal - a.hNodes === e.v;
    case 'R': return e.v === null ? a.ringCount > 0 : a.ringCount === e.v;
    case 'r': return e.v === null ? a.ringCount > 0 : a.ringSizes.has(e.v);
    case 'v': {
      let s = a.hTotal - a.hNodes;
      for (const { bond } of g.adj[i]) s += g.bonds[bond].order;
      return s === e.v;
    }
    case 'x': {
      let c = 0;
      for (const { bond } of g.adj[i]) if (g.bonds[bond].inRing) c++;
      return e.v === null ? c > 0 : c === e.v;
    }
    case 'rec': return recursiveMatch(e.p, g, i);
    default: return false;
  }
}

function bondOk(e, g, bi) {
  const b = g.bonds[bi];
  switch (e.t) {
    case 'default': return b.aromatic || b.order === 1;
    case 'single': return !b.aromatic && b.order === 1;
    case 'double': return !b.aromatic && b.order === 2;
    case 'triple': return b.order === 3;
    case 'arom': return b.aromatic;
    case 'any': return true;
    case 'ring': return b.inRing;
    case 'and': for (const x of e.args) if (!bondOk(x, g, bi)) return false; return true;
    case 'or': for (const x of e.args) if (bondOk(x, g, bi)) return true; return false;
    case 'not': return !bondOk(e.arg, g, bi);
    default: return false;
  }
}

function bondIndex(g, i, j) {
  for (const e of g.adj[i]) if (e.nbr === j) return e.bond;
  return -1;
}

function search(p, g, start, onMatch) {
  if (!atomOk(p.atoms[0], g, start)) return false;
  const n = p.atoms.length;
  const map = new Array(n).fill(-1);
  const used = new Set([start]);
  map[0] = start;
  const rec = (k) => {
    if (k === n) return onMatch ? onMatch(map) : true;
    const par = p.parent[k];
    for (const { nbr, bond } of g.adj[map[par.atom]]) {
      if (used.has(nbr) || !bondOk(par.bond, g, bond) || !atomOk(p.atoms[k], g, nbr)) continue;
      let ok = true;
      for (const c of p.closures[k]) {
        const bi = bondIndex(g, nbr, map[c.atom]);
        if (bi < 0 || !bondOk(c.bond, g, bi)) { ok = false; break; }
      }
      if (!ok) continue;
      map[k] = nbr;
      used.add(nbr);
      if (rec(k + 1)) return true;
      used.delete(nbr);
      map[k] = -1;
    }
    return false;
  };
  return rec(1);
}

function recursiveMatch(p, g, i) {
  if (!g.__rec) Object.defineProperty(g, '__rec', { value: new Map(), enumerable: false });
  const key = `${p.id}:${i}`;
  let v = g.__rec.get(key);
  if (v === undefined) {
    v = search(p, g, i, null);
    g.__rec.set(key, v);
  }
  return v;
}

/** True when the pattern matches with its first atom mapped onto atom i. */
export function matchesAt(pattern, g, i) {
  const p = typeof pattern === 'string' ? compileSmarts(pattern) : pattern;
  return search(p, g, i, null);
}

/** All matches, de-duplicated by the set of matched atoms. */
export function findAll(pattern, g, { limit = 1000 } = {}) {
  const p = typeof pattern === 'string' ? compileSmarts(pattern) : pattern;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < g.atoms.length && out.length < limit; i++) {
    search(p, g, i, (map) => {
      const key = [...map].sort((x, y) => x - y).join(',');
      if (!seen.has(key)) { seen.add(key); out.push([...map]); }
      return out.length >= limit;
    });
  }
  return out;
}
