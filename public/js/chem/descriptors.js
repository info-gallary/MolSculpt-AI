// Molecular descriptors and drug-likeness rules computed from a perceived graph.

import { ELEMENTS } from './elements.js';
import { withExplicitHydrogens } from './perception.js';
import { compileSmarts, matchesAt, findAll } from './smarts.js';
import { CRIPPEN, CRIPPEN_MR } from './crippen.js';

// RDKit's default ("strict") rotatable-bond definition: excludes amide/ester
// C–X bonds, CF3/CCl3/CBr3/t-butyl rotors and bonds next to triple bonds.
const ROTATABLE = compileSmarts(
  '[!$(*#*)&!D1&!$(C(F)(F)F)&!$(C(Cl)(Cl)Cl)&!$(C(Br)(Br)Br)&!$(C([CH3])([CH3])[CH3])'
  + '&!$([CD3](=[N,O,S])-!@[#7,O,S!D1])&!$([#7,O,S!D1]-!@[CD3]=[N,O,S])&!$([CD3](=[N+])-!@[#7!D1])'
  + '&!$([#7!D1]-!@[CD3]=[N+])]-,:;!@[!$(*#*)&!D1&!$(C(F)(F)F)&!$(C(Cl)(Cl)Cl)&!$(C(Br)(Br)Br)'
  + '&!$(C([CH3])([CH3])[CH3])]',
);

const CRIPPEN_COMPILED = CRIPPEN.map(([type, smarts, logp]) => ({ type, logp, mr: CRIPPEN_MR[type] ?? 0, p: compileSmarts(smarts) }));

export function molecularFormula(g) {
  const counts = {};
  let charge = 0;
  for (const a of g.atoms) {
    counts[a.el] = (counts[a.el] || 0) + 1;
    if (a.hTotal) counts.H = (counts.H || 0) + a.hTotal;
    charge += a.charge;
  }
  const order = counts.C
    ? ['C', ...(counts.H ? ['H'] : []), ...Object.keys(counts).filter((e) => e !== 'C' && e !== 'H').sort()]
    : Object.keys(counts).sort();
  const part = (e) => e + (counts[e] > 1 ? counts[e] : '');
  const sub = (e) => e + (counts[e] > 1 ? `<sub>${counts[e]}</sub>` : '');
  const chg = charge === 0 ? '' : (Math.abs(charge) > 1 ? Math.abs(charge) : '') + (charge > 0 ? '+' : '-');
  return {
    text: order.map(part).join('') + chg,
    html: order.map(sub).join('') + (chg ? `<sup>${chg}</sup>` : ''),
    counts,
    charge,
  };
}

/** Topological polar surface area (Ertl 2000), N and O contributions only. */
export function tpsa(g) {
  let total = 0;
  g.atoms.forEach((a, i) => {
    if (a.z !== 7 && a.z !== 8) return;
    const nH = a.hTotal;
    const chg = a.charge;
    const nb = a.degree;
    const in3 = a.ringSizes.has(3);
    let s = 0, d = 0, t = 0, ar = 0;
    for (const { bond } of g.adj[i]) {
      const b = g.bonds[bond];
      if (b.aromatic) ar++;
      else if (b.order === 1) s++;
      else if (b.order === 2) d++;
      else if (b.order === 3) t++;
    }
    let v = -1;
    if (a.z === 7) {
      if (nb === 1) {
        if (nH === 0 && t === 1 && chg === 0) v = 23.79;
        else if (nH === 1 && d === 1 && chg === 0) v = 23.85;
        else if (nH === 2 && s === 1 && chg === 0) v = 26.02;
        else if (nH === 2 && d === 1 && chg === 1) v = 25.59;
        else if (nH === 3 && s === 1 && chg === 1) v = 27.64;
      } else if (nb === 2) {
        if (nH === 0 && s === 1 && d === 1 && chg === 0) v = 12.36;
        else if (nH === 0 && t === 1 && d === 1 && chg === 0) v = 13.6;
        else if (nH === 1 && s === 2 && chg === 0) v = in3 ? 21.94 : 12.03;
        else if (nH === 0 && t === 1 && s === 1 && chg === 1) v = 4.36;
        else if (nH === 1 && d === 1 && s === 1 && chg === 1) v = 13.97;
        else if (nH === 2 && s === 2 && chg === 1) v = 16.61;
        else if (nH === 0 && ar === 2 && chg === 0) v = 12.89;
        else if (nH === 1 && ar === 2 && chg === 0) v = 15.79;
        else if (nH === 1 && ar === 2 && chg === 1) v = 14.14;
      } else if (nb === 3) {
        if (nH === 0 && s === 3 && chg === 0) v = in3 ? 3.01 : 3.24;
        else if (nH === 0 && s === 1 && d === 2 && chg === 0) v = 11.68;
        else if (nH === 0 && s === 2 && d === 1 && chg === 1) v = 3.01;
        else if (nH === 1 && s === 3 && chg === 1) v = 4.44;
        else if (nH === 0 && ar === 3 && chg === 0) v = 4.41;
        else if (nH === 0 && s === 1 && ar === 2 && chg === 0) v = 4.93;
        else if (nH === 0 && d === 1 && ar === 2 && chg === 0) v = 8.39;
        else if (nH === 0 && ar === 3 && chg === 1) v = 4.1;
        else if (nH === 0 && s === 1 && ar === 2 && chg === 1) v = 3.88;
      } else if (nb === 4) {
        if (nH === 0 && s === 4 && chg === 1) v = 0;
      }
      if (v < 0) v = Math.max(0, 30.5 - nb * 8.2 + nH * 1.5);
    } else {
      if (nb === 1) {
        if (nH === 0 && d === 1 && chg === 0) v = 17.07;
        else if (nH === 1 && s === 1 && chg === 0) v = 20.23;
        else if (nH === 0 && s === 1 && chg === -1) v = 23.06;
      } else if (nb === 2) {
        if (nH === 0 && s === 2 && chg === 0) v = in3 ? 12.53 : 9.23;
        else if (nH === 0 && ar === 2 && chg === 0) v = 13.14;
      }
      if (v < 0) v = Math.max(0, 28.5 - nb * 8.6 + nH * 1.5);
    }
    total += v;
  });
  return total;
}

/** Wildman–Crippen logP and molar refractivity with per-atom types. */
export function crippen(g) {
  const gh = withExplicitHydrogens(g);
  const types = new Array(gh.atoms.length).fill(null);
  let logp = 0;
  let mr = 0;
  for (const c of CRIPPEN_COMPILED) {
    for (let i = 0; i < gh.atoms.length; i++) {
      if (types[i] !== null || !matchesAt(c.p, gh, i)) continue;
      types[i] = c.type;
      logp += c.logp;
      mr += c.mr;
    }
  }
  return { logp, mr, types: types.slice(0, g.atoms.length) };
}

export function rotatableBonds(g) {
  return findAll(ROTATABLE, g).length;
}

const esolClass = (logS) => {
  if (logS >= 0) return 'Highly soluble';
  if (logS >= -2) return 'Very soluble';
  if (logS >= -4) return 'Soluble';
  if (logS >= -6) return 'Moderately soluble';
  if (logS >= -10) return 'Poorly soluble';
  return 'Insoluble';
};

export function computeDescriptors(g) {
  const formula = molecularFormula(g);
  let mw = 0;
  let exact = 0;
  let hbd = 0;
  let hba = 0;
  let carbons = 0;
  let sp3 = 0;
  let aromaticAtoms = 0;
  let hetero = 0;
  let halogens = 0;
  let totalH = 0;
  g.atoms.forEach((a, i) => {
    const e = ELEMENTS[a.el];
    mw += e.mass + a.hTotal * ELEMENTS.H.mass;
    exact += e.mono + a.hTotal * ELEMENTS.H.mono;
    totalH += a.hTotal;
    if (a.z === 7 || a.z === 8) { hba++; hbd += a.hTotal; }
    if (a.z !== 6 && a.z !== 1) hetero++;
    if ([9, 17, 35, 53].includes(a.z)) halogens++;
    if (a.aromatic) aromaticAtoms++;
    if (a.z === 6) {
      carbons++;
      if (!a.aromatic && g.adj[i].every((e2) => g.bonds[e2.bond].order === 1)) sp3++;
    }
  });
  const heavy = g.atoms.length;
  const { logp, mr } = crippen(g);
  const polar = tpsa(g);
  const rotb = rotatableBonds(g);
  const rings = g.rings.length;
  const aromaticRings = g.rings.filter((r) => r.aromatic).length;
  const aromaticProportion = heavy ? aromaticAtoms / heavy : 0;
  const logS = 0.16 - 0.63 * logp - 0.0062 * mw + 0.066 * rotb - 0.74 * aromaticProportion;

  const c = formula.counts;
  const dbe = formula.charge === 0 && heavy
    ? (c.C || 0) + (c.Si || 0) - ((c.H || 0) + halogens) / 2 + ((c.N || 0) + (c.P || 0)) / 2 + 1
    : null;

  const lipinskiRules = [
    { rule: 'MW ≤ 500', ok: mw <= 500 },
    { rule: 'logP ≤ 5', ok: logp <= 5 },
    { rule: 'H-bond donors ≤ 5', ok: hbd <= 5 },
    { rule: 'H-bond acceptors ≤ 10', ok: hba <= 10 },
  ];
  const lipinskiViolations = lipinskiRules.filter((r) => !r.ok).length;
  const totalAtoms = heavy + totalH;

  return {
    formula: formula.text,
    formulaHtml: formula.html,
    charge: formula.charge,
    molecularWeight: mw,
    exactMass: exact,
    heavyAtoms: heavy,
    heteroAtoms: hetero,
    hbd,
    hba,
    rotatableBonds: rotb,
    rings,
    aromaticRings,
    tpsa: polar,
    logP: logp,
    molarRefractivity: mr,
    fractionCsp3: carbons ? sp3 / carbons : 0,
    doubleBondEquivalents: dbe,
    esolLogS: logS,
    solubilityClass: esolClass(logS),
    rules: {
      lipinski: { pass: lipinskiViolations <= 1, violations: lipinskiViolations, details: lipinskiRules },
      veber: { pass: rotb <= 10 && polar <= 140, details: [{ rule: 'Rotatable bonds ≤ 10', ok: rotb <= 10 }, { rule: 'TPSA ≤ 140 Å²', ok: polar <= 140 }] },
      egan: { pass: logp <= 5.88 && polar <= 131.6, details: [{ rule: 'logP ≤ 5.88', ok: logp <= 5.88 }, { rule: 'TPSA ≤ 131.6 Å²', ok: polar <= 131.6 }] },
      ghose: {
        pass: mw >= 160 && mw <= 480 && logp >= -0.4 && logp <= 5.6 && mr >= 40 && mr <= 130 && totalAtoms >= 20 && totalAtoms <= 70,
        details: [
          { rule: '160 ≤ MW ≤ 480', ok: mw >= 160 && mw <= 480 },
          { rule: '−0.4 ≤ logP ≤ 5.6', ok: logp >= -0.4 && logp <= 5.6 },
          { rule: '40 ≤ MR ≤ 130', ok: mr >= 40 && mr <= 130 },
          { rule: '20 ≤ atoms ≤ 70', ok: totalAtoms >= 20 && totalAtoms <= 70 },
        ],
      },
      leadLike: {
        pass: mw >= 250 && mw <= 350 && logp <= 3.5 && rotb <= 7,
        details: [{ rule: '250 ≤ MW ≤ 350', ok: mw >= 250 && mw <= 350 }, { rule: 'logP ≤ 3.5', ok: logp <= 3.5 }, { rule: 'Rotatable bonds ≤ 7', ok: rotb <= 7 }],
      },
    },
  };
}
