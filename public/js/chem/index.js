// Public facade of the chemistry engine. Shared verbatim by the browser UI
// and the Node.js agent server so both see identical numbers.

import { Molecule } from './molecule.js';
import { perceive } from './perception.js';
import { computeDescriptors } from './descriptors.js';
import { findFunctionalGroups, findStructuralAlerts } from './groups.js';
import { parseSmiles, writeSmiles, graphSignature, SmilesError } from './smiles.js';
import { layoutMolecule } from './layout.js';

export { Molecule, perceive, computeDescriptors, parseSmiles, writeSmiles, graphSignature, SmilesError, layoutMolecule };

/** Full analysis of an editable molecule. */
export function analyze(mol) {
  const graph = perceive(mol);
  if (!graph.atoms.length) {
    return { empty: true, graph, smiles: '', signature: '', descriptors: null, groups: [], alerts: [], problems: [], notes: [] };
  }
  return {
    empty: false,
    graph,
    smiles: writeSmiles(graph),
    signature: graphSignature(graph),
    descriptors: computeDescriptors(graph),
    groups: findFunctionalGroups(graph),
    alerts: findStructuralAlerts(graph),
    problems: graph.problems,
    notes: graph.notes,
  };
}

/** Parse + analyse a SMILES string (used by the agent's tools). */
export function analyzeSmiles(smiles) {
  return analyze(parseSmiles(smiles));
}

/** JSON-friendly summary (no graph internals) for APIs and logs. */
export function summarize(result) {
  if (result.empty) return { empty: true };
  const d = result.descriptors;
  const r = (x, k = 2) => (x === null || x === undefined ? null : Number(x.toFixed(k)));
  return {
    smiles: result.smiles,
    formula: d.formula,
    molecular_weight: r(d.molecularWeight),
    exact_mass: r(d.exactMass, 4),
    heavy_atoms: d.heavyAtoms,
    formal_charge: d.charge,
    clogp_crippen: r(d.logP),
    molar_refractivity: r(d.molarRefractivity),
    tpsa_A2: r(d.tpsa),
    h_bond_donors: d.hbd,
    h_bond_acceptors: d.hba,
    rotatable_bonds: d.rotatableBonds,
    rings: d.rings,
    aromatic_rings: d.aromaticRings,
    fraction_csp3: r(d.fractionCsp3),
    double_bond_equivalents: d.doubleBondEquivalents,
    esol_logS: r(d.esolLogS),
    solubility_class: d.solubilityClass,
    functional_groups: result.groups.map((g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name)),
    valence_problems: result.problems.map((p) => p.message),
  };
}
