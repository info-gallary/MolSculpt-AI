// Functional-group perception and medicinal-chemistry structural alerts,
// both expressed as SMARTS so they are easy to audit and extend.

import { findAll } from './smarts.js';

export const FUNCTIONAL_GROUPS = [
  { key: 'carboxylic_acid', name: 'Carboxylic acid', smarts: '[CX3](=O)[OX2H1]' },
  { key: 'carboxylate', name: 'Carboxylate', smarts: '[CX3](=O)[OX1-]' },
  { key: 'ester', name: 'Ester', smarts: '[#6][CX3](=O)[OX2H0][#6]' },
  { key: 'lactone', name: 'Lactone (cyclic ester)', smarts: '[#6][CX3;R](=O)[OX2H0;R][#6]' },
  { key: 'amide', name: 'Amide', smarts: '[NX3][CX3](=[OX1])[#6]' },
  { key: 'lactam', name: 'Lactam (cyclic amide)', smarts: '[NX3;R][CX3;R](=[OX1])[#6]' },
  { key: 'urea', name: 'Urea', smarts: '[NX3][CX3](=[OX1])[NX3]' },
  { key: 'ring_carbonyl', name: 'Aromatic lactam / imide carbonyl', smarts: '[OX1;$(O=c~n)]' },
  { key: 'carbamate', name: 'Carbamate', smarts: '[NX3][CX3](=[OX1])[OX2][#6]' },
  { key: 'aldehyde', name: 'Aldehyde', smarts: '[CX3H1](=O)[#6,#1]' },
  { key: 'formaldehyde', name: 'Aldehyde', smarts: '[CX3H2]=O' },
  { key: 'ketone', name: 'Ketone', smarts: '[#6][CX3](=O)[#6]' },
  { key: 'alcohol', name: 'Alcohol (hydroxyl)', smarts: '[OX2H][CX4]' },
  { key: 'phenol', name: 'Phenol', smarts: '[OX2H]c' },
  { key: 'ether', name: 'Ether', smarts: '[OD2;!$(O[#6]=[O,S,N]);!$(O[#6]=[#6])]([#6])[#6]' },
  { key: 'enol_ether', name: 'Enol ether', smarts: '[OD2]([#6])[CX3]=[CX3]' },
  { key: 'amine_primary', name: 'Primary amine', smarts: '[NX3;H2;!$(N[#6]=[O,S,N]);!$(N-[!#6;!#1])][CX4]' },
  { key: 'amine_secondary', name: 'Secondary amine', smarts: '[NX3;H1;!$(N[#6]=[O,S,N]);!$(N-[!#6;!#1])]([CX4])[CX4]' },
  { key: 'amine_tertiary', name: 'Tertiary amine', smarts: '[NX3;H0;!$(N[#6]=[O,S,N]);!$(N-[!#6;!#1])]([CX4])([CX4])[CX4]' },
  { key: 'aniline', name: 'Aromatic amine (aniline)', smarts: '[NX3;!$(N[#6]=[O,S,N]);!$(N-[!#6;!#1])]-c' },
  { key: 'ammonium', name: 'Quaternary ammonium', smarts: '[NX4+]' },
  { key: 'amidine', name: 'Amidine / guanidine', smarts: '[NX3][CX3]=[NX2]' },
  { key: 'imine', name: 'Imine', smarts: '[CX3;!$(C[NX3])]=[NX2]' },
  { key: 'nitrile', name: 'Nitrile', smarts: '[NX1]#[CX2]' },
  { key: 'nitro', name: 'Nitro', smarts: '[NX3+](=O)[O-]' },
  { key: 'azo', name: 'Azo', smarts: '[#6][NX2]=[NX2][#6]' },
  { key: 'azide', name: 'Azide', smarts: '[NX2]=[N+]=[N-]' },
  { key: 'hydrazine', name: 'Hydrazine', smarts: '[NX3][NX3]' },
  { key: 'alkene', name: 'Alkene (C=C)', smarts: '[CX3]=[CX3]' },
  { key: 'alkyne', name: 'Alkyne (C≡C)', smarts: '[CX2]#[CX2]' },
  { key: 'alkyl_halide', name: 'Alkyl halide', smarts: '[CX4][F,Cl,Br,I]' },
  { key: 'aryl_halide', name: 'Aryl halide', smarts: 'c[F,Cl,Br,I]' },
  { key: 'acyl_halide', name: 'Acyl halide', smarts: '[CX3](=O)[F,Cl,Br,I]' },
  { key: 'anhydride', name: 'Anhydride', smarts: '[CX3](=O)[OX2][CX3](=O)' },
  { key: 'epoxide', name: 'Epoxide', smarts: 'C1OC1' },
  { key: 'thiol', name: 'Thiol', smarts: '[SX2H]' },
  { key: 'thioether', name: 'Thioether (sulfide)', smarts: '[SX2]([#6])[#6]' },
  { key: 'disulfide', name: 'Disulfide', smarts: '[SX2][SX2]' },
  { key: 'sulfoxide', name: 'Sulfoxide', smarts: '[#6][SX3](=O)[#6]' },
  { key: 'sulfone', name: 'Sulfone', smarts: '[#6][SX4](=O)(=O)[#6]' },
  { key: 'sulfonamide', name: 'Sulfonamide', smarts: '[SX4](=O)(=O)[NX3]' },
  { key: 'sulfonic_acid', name: 'Sulfonic acid', smarts: '[SX4](=O)(=O)[OX2H]' },
  { key: 'phosphate', name: 'Phosphate / phosphonate', smarts: '[PX4](=O)([OX2])[OX2]' },
  { key: 'isocyanate', name: 'Isocyanate / isothiocyanate', smarts: '[NX2]=C=[O,S]' },
  { key: 'peroxide', name: 'Peroxide', smarts: '[OX2][OX2]' },
  { key: 'michael_acceptor', name: 'α,β-Unsaturated carbonyl', smarts: '[CX3]=[CX3][CX3]=O' },
  { key: 'beta_lactam', name: 'β-Lactam', smarts: 'O=C1CCN1' },
];

// Structural alerts (simplified from Brenk et al. 2008 and PAINS, Baell & Holloway 2010).
export const STRUCTURAL_ALERTS = [
  { key: 'nitroaromatic', name: 'Aromatic nitro', severity: 'high', smarts: 'c[N+](=O)[O-]', why: 'Can be reduced to reactive hydroxylamines; linked to mutagenicity (Ames positive).' },
  { key: 'aromatic_amine', name: 'Primary aromatic amine', severity: 'medium', smarts: '[NH2]-c', why: 'Metabolic N-oxidation can give DNA-reactive nitrenium ions.' },
  { key: 'aldehyde', name: 'Aldehyde', severity: 'medium', smarts: '[CX3H1](=O)[#6]', why: 'Electrophilic; reacts with protein amines; often metabolically labile.' },
  { key: 'epoxide', name: 'Epoxide', severity: 'high', smarts: 'C1OC1', why: 'Strained alkylating agent; reacts with DNA and proteins.' },
  { key: 'aziridine', name: 'Aziridine', severity: 'high', smarts: 'C1NC1', why: 'Strained alkylating agent.' },
  { key: 'alkyl_halide', name: 'Reactive alkyl halide', severity: 'medium', smarts: '[CH2X4,CH1X4,CH3X4][Cl,Br,I]', why: 'Potential alkylating agent (SN2 reactive).' },
  { key: 'acyl_halide', name: 'Acyl halide', severity: 'high', smarts: '[CX3](=O)[Cl,Br,I,F]', why: 'Highly reactive acylating agent; hydrolyses in water.' },
  { key: 'anhydride', name: 'Anhydride', severity: 'medium', smarts: '[CX3](=O)[OX2][CX3](=O)', why: 'Reactive acylating agent.' },
  { key: 'michael_acceptor', name: 'Michael acceptor', severity: 'low', smarts: '[CX3;!R]=[CX3][CX3]=O', why: 'Can covalently modify cysteine residues (sometimes intentional in covalent drugs).' },
  { key: 'azo', name: 'Azo group', severity: 'medium', smarts: 'c[NX2]=[NX2]c', why: 'Reductive cleavage can release aromatic amines.' },
  { key: 'azide', name: 'Azide', severity: 'high', smarts: '[NX2]=[N+]=[N-]', why: 'Potentially explosive and toxic.' },
  { key: 'isocyanate', name: 'Isocyanate / isothiocyanate', severity: 'high', smarts: '[NX2]=C=[O,S]', why: 'Strong electrophile; respiratory sensitiser.' },
  { key: 'peroxide', name: 'Peroxide', severity: 'high', smarts: '[OX2][OX2]', why: 'Oxidising and potentially explosive.' },
  { key: 'hydrazine', name: 'Hydrazine', severity: 'medium', smarts: '[NX3;!$(NC=O)][NX3;!$(NC=O)]', why: 'Associated with hepatotoxicity and genotoxicity.' },
  { key: 'thiol', name: 'Free thiol', severity: 'low', smarts: '[SX2H]', why: 'Readily oxidised; can form disulfides with proteins.' },
  { key: 'quinone', name: 'Quinone', severity: 'medium', smarts: 'O=C1C=CC(=O)C=C1', why: 'Redox cycling; frequent PAINS false positive.' },
  { key: 'catechol', name: 'Catechol', severity: 'low', smarts: '[OH]c:c[OH]', why: 'Oxidises to quinones; PAINS motif in screening assays.' },
  { key: 'rhodanine', name: 'Rhodanine-like', severity: 'medium', smarts: 'S=C1SCC(=O)N1', why: 'Classic PAINS scaffold (promiscuous assay activity).' },
  { key: 'polyene', name: 'Long aliphatic chain', severity: 'low', smarts: '[CH2][CH2][CH2][CH2][CH2][CH2][CH2]', why: 'High lipophilicity, poor solubility and metabolic liability.' },
  { key: 'phosphor_ester', name: 'Phosphorus ester', severity: 'medium', smarts: 'P(=[O,S])(O[#6])O[#6]', why: 'Organophosphate motif; possible acetylcholinesterase inhibition.' },
];

const toIds = (g, matches) => matches.map((m) => m.map((i) => g.atoms[i].id));

/** Functional groups present, each with match count and atom ids. */
export function findFunctionalGroups(g) {
  const out = [];
  const byName = new Map();
  for (const fg of FUNCTIONAL_GROUPS) {
    const matches = findAll(fg.smarts, g);
    if (!matches.length) continue;
    // Merge groups that share a display name (e.g. the two aldehyde patterns).
    const existing = byName.get(fg.name);
    if (existing) {
      existing.count += matches.length;
      existing.atoms.push(...toIds(g, matches));
      continue;
    }
    const entry = { key: fg.key, name: fg.name, count: matches.length, atoms: toIds(g, matches) };
    byName.set(fg.name, entry);
    out.push(entry);
  }
  for (const ring of describeRings(g)) out.push(ring);
  return out;
}

/** Named aromatic / saturated rings (benzene, pyridine, furan, ...). */
export function describeRings(g) {
  const named = new Map();
  for (const r of g.rings) {
    const els = r.atoms.map((i) => g.atoms[i].el);
    const nN = els.filter((e) => e === 'N').length;
    const nO = els.filter((e) => e === 'O').length;
    const nS = els.filter((e) => e === 'S').length;
    let name;
    if (r.aromatic) {
      if (r.size === 6) {
        if (nN === 0 && nO === 0 && nS === 0) name = 'Benzene ring';
        else if (nN === 1) name = 'Pyridine ring';
        else if (nN === 2) name = 'Diazine ring (pyrimidine/pyrazine)';
        else if (nN >= 3) name = 'Triazine ring';
        else name = 'Heteroaromatic 6-ring';
      } else if (r.size === 5) {
        if (nN === 1 && nO === 0 && nS === 0) name = 'Pyrrole ring';
        else if (nO === 1 && nN === 0) name = 'Furan ring';
        else if (nS === 1 && nN === 0) name = 'Thiophene ring';
        else if (nN === 2) name = 'Azole ring (imidazole/pyrazole)';
        else if (nN === 1 && nS === 1) name = 'Thiazole ring';
        else if (nN === 1 && nO === 1) name = 'Oxazole ring';
        else name = 'Heteroaromatic 5-ring';
      } else {
        name = `Aromatic ${r.size}-ring`;
      }
    } else {
      const hetero = nN + nO + nS;
      if (r.size === 3) name = hetero ? 'Three-membered heterocycle' : 'Cyclopropane ring';
      else if (r.size === 6 && nN === 1 && hetero === 1) name = 'Piperidine ring';
      else if (r.size === 6 && nN === 2 && hetero === 2) name = 'Piperazine ring';
      else if (r.size === 6 && nN === 1 && nO === 1) name = 'Morpholine ring';
      else if (r.size === 5 && nN === 1 && hetero === 1) name = 'Pyrrolidine ring';
      else if (r.size === 6 && nO === 1 && hetero === 1) name = 'Tetrahydropyran ring';
      else if (hetero) name = `Saturated ${r.size}-membered heterocycle`;
      else name = `Cycloalkane ${r.size}-ring`;
    }
    const ids = r.atoms.map((i) => g.atoms[i].id);
    if (!named.has(name)) named.set(name, { key: `ring:${name}`, name, count: 0, atoms: [], ring: true });
    const e = named.get(name);
    e.count++;
    e.atoms.push(ids);
  }
  return [...named.values()];
}

export function findStructuralAlerts(g) {
  const out = [];
  for (const al of STRUCTURAL_ALERTS) {
    const matches = findAll(al.smarts, g);
    if (matches.length) {
      out.push({ key: al.key, name: al.name, severity: al.severity, why: al.why, count: matches.length, atoms: toIds(g, matches) });
    }
  }
  return out;
}
