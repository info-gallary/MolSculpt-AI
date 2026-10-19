// Periodic-table data used by the chemistry engine.
// Average atomic weights and monoisotopic masses match the RDKit periodic table
// so that computed molecular weights agree with the reference toolkit.

export const ELEMENTS = {
  H:  { z: 1,  name: 'Hydrogen',   mass: 1.008,   mono: 1.007825032 },
  B:  { z: 5,  name: 'Boron',      mass: 10.812,  mono: 11.0093054 },
  C:  { z: 6,  name: 'Carbon',     mass: 12.011,  mono: 12.0 },
  N:  { z: 7,  name: 'Nitrogen',   mass: 14.007,  mono: 14.003074 },
  O:  { z: 8,  name: 'Oxygen',     mass: 15.999,  mono: 15.99491462 },
  F:  { z: 9,  name: 'Fluorine',   mass: 18.998,  mono: 18.99840322 },
  Si: { z: 14, name: 'Silicon',    mass: 28.086,  mono: 27.97692653 },
  P:  { z: 15, name: 'Phosphorus', mass: 30.974,  mono: 30.97376163 },
  S:  { z: 16, name: 'Sulfur',     mass: 32.067,  mono: 31.972071 },
  Cl: { z: 17, name: 'Chlorine',   mass: 35.453,  mono: 34.96885268 },
  Se: { z: 34, name: 'Selenium',   mass: 78.96,   mono: 79.9165213 },
  Br: { z: 35, name: 'Bromine',    mass: 79.904,  mono: 78.9183371 },
  I:  { z: 53, name: 'Iodine',     mass: 126.904, mono: 126.904473 },
};

export const SYMBOL_BY_Z = Object.fromEntries(
  Object.entries(ELEMENTS).map(([sym, e]) => [e.z, sym]),
);

// Allowed valences indexed by atomic number (RDKit-style defaults).
const VALENCE_BY_Z = {
  1: [1], 2: [0], 5: [3], 6: [4], 7: [3], 8: [2], 9: [1], 10: [0],
  13: [3], 14: [4], 15: [3, 5, 7], 16: [2, 4, 6], 17: [1], 18: [0],
  32: [4], 33: [3, 5], 34: [2, 4, 6], 35: [1], 36: [0],
  51: [3, 5], 52: [2, 4, 6], 53: [1, 3, 5], 54: [0],
};

/**
 * Valences an atom may adopt. Charged p-block atoms are treated as their
 * isoelectronic neighbour (N+ behaves like C, O- like F, C+ like B, ...).
 */
export function allowedValences(z, charge = 0) {
  if (z === 1) return charge === 0 ? [1] : [0];
  return VALENCE_BY_Z[z - charge] ?? VALENCE_BY_Z[z] ?? [4];
}

// Organic-subset symbols that SMILES can write without brackets.
export const ORGANIC_SUBSET = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I']);
export const AROMATIC_SYMBOLS = { b: 'B', c: 'C', n: 'N', o: 'O', p: 'P', s: 'S', se: 'Se' };

// Elements offered in the editor palette, in the order shown.
export const PALETTE = ['C', 'N', 'O', 'H', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
