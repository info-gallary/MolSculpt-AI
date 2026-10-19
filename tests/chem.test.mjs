// Unit tests for the chemistry engine. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Molecule, parseSmiles, analyze, perceive, writeSmiles, graphSignature, layoutMolecule } from '../public/js/chem/index.js';
import { findAll } from '../public/js/chem/smarts.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('formula and molecular weight of common drugs', () => {
  const cases = [
    ['CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4', 180.159],
    ['CC(=O)Nc1ccc(O)cc1', 'C8H9NO2', 151.165],
    ['Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2', 194.194],
    ['CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'C13H18O2', 206.285],
  ];
  for (const [smi, formula, mw] of cases) {
    const d = analyze(parseSmiles(smi)).descriptors;
    assert.equal(d.formula, formula);
    near(d.molecularWeight, mw, 0.005);
  }
});

test('Crippen logP and TPSA match RDKit reference values', () => {
  const aspirin = analyze(parseSmiles('CC(=O)Oc1ccccc1C(=O)O')).descriptors;
  near(aspirin.logP, 1.3101, 0.001);
  near(aspirin.tpsa, 63.6, 0.01);
  const caffeine = analyze(parseSmiles('Cn1cnc2c1c(=O)n(C)c(=O)n2C')).descriptors;
  near(caffeine.tpsa, 61.82, 0.01);
  near(caffeine.logP, -1.0293, 0.001);
});

test('implicit hydrogens follow default valences', () => {
  const m = new Molecule();
  const c = m.addAtom('C');
  const o = m.addAtom('O');
  m.addBond(c.id, o.id, 1);
  const g = perceive(m);
  assert.equal(g.atoms[0].hTotal, 3);
  assert.equal(g.atoms[1].hTotal, 1);
  assert.equal(analyze(m).descriptors.formula, 'CH4O');
});

test('over-valent atoms are reported, not silently accepted', () => {
  const m = new Molecule();
  const c = m.addAtom('C');
  for (let i = 0; i < 5; i++) m.addBond(c.id, m.addAtom('C').id, 1);
  const res = analyze(m);
  assert.equal(res.problems.length, 1);
  assert.equal(res.problems[0].atomId, c.id);
});

test('explicitly drawn hydrogens are folded into their heavy atom', () => {
  const m = new Molecule();
  const o = m.addAtom('O');
  m.addBond(o.id, m.addAtom('H').id, 1);
  m.addBond(o.id, m.addAtom('H').id, 1);
  assert.equal(analyze(m).descriptors.formula, 'H2O');
});

test('a Kekulé benzene drawn by hand is perceived as aromatic', () => {
  const m = new Molecule();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(m.addAtom('C').id);
  for (let i = 0; i < 6; i++) m.addBond(ids[i], ids[(i + 1) % 6], i % 2 ? 1 : 2);
  const res = analyze(m);
  assert.equal(res.smiles, 'c1ccccc1');
  assert.equal(res.descriptors.aromaticRings, 1);
});

test('both Kekulé forms give the same graph signature', () => {
  const sig = (orders) => {
    const m = new Molecule();
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(m.addAtom('C').id);
    for (let i = 0; i < 6; i++) m.addBond(ids[i], ids[(i + 1) % 6], orders[i]);
    m.addBond(ids[0], m.addAtom('O').id, 1);
    return graphSignature(perceive(m));
  };
  assert.equal(sig([1, 2, 1, 2, 1, 2]), sig([2, 1, 2, 1, 2, 1]));
  assert.equal(sig([1, 2, 1, 2, 1, 2]), graphSignature(perceive(parseSmiles('Oc1ccccc1'))));
  assert.notEqual(sig([1, 2, 1, 2, 1, 2]), graphSignature(perceive(parseSmiles('Nc1ccccc1'))));
});

test('nitro drawn as N(=O)=O is normalised to the charge-separated form', () => {
  const res = analyze(parseSmiles('O=N(=O)c1ccccc1'));
  assert.equal(res.problems.length, 0);
  assert.equal(res.descriptors.formula, 'C6H5NO2');
  assert.ok(res.groups.some((g) => g.name === 'Nitro'));
  assert.ok(res.alerts.some((a) => a.key === 'nitroaromatic'));
});

test('SMILES writer output re-parses to the same molecule', () => {
  for (const smi of ['OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', 'c1ccc2[nH]ccc2c1', 'CC(C)(C)NCC(O)c1ccc(O)c(CO)c1', 'C1CN2CCC1CC2']) {
    const g1 = perceive(parseSmiles(smi));
    const g2 = perceive(parseSmiles(writeSmiles(g1)));
    assert.equal(graphSignature(g1), graphSignature(g2), smi);
  }
});

test('functional groups of aspirin', () => {
  const names = analyze(parseSmiles('CC(=O)Oc1ccccc1C(=O)O')).groups.map((g) => g.name);
  for (const n of ['Carboxylic acid', 'Ester', 'Benzene ring']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('Ketone'));
});

test('SMARTS engine handles recursion, logic and ring closures', () => {
  const g = perceive(parseSmiles('OCC(=O)OC1CC1'));
  assert.equal(findAll('[OX2H][CX4]', g).length, 1);
  assert.equal(findAll('[$(C=O)]', g).length, 1);
  assert.equal(findAll('C1CC1', g).length, 1);
  assert.equal(findAll('[!#6;!#1]', g).length, 3);
});

test('drug-likeness rules', () => {
  const r = analyze(parseSmiles('CC(=O)Oc1ccccc1C(=O)O')).descriptors.rules;
  assert.equal(r.lipinski.violations, 0);
  assert.ok(r.veber.pass);
});

test('layout gives finite coordinates and near-uniform bond lengths', () => {
  const m = layoutMolecule(parseSmiles('CN1C(=O)CN=C(c2ccccc2)c2cc(Cl)ccc21'), { bondLength: 50 });
  for (const a of m.atoms.values()) assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
  const lens = [...m.bonds.values()].map((b) => {
    const p = m.atoms.get(b.a), q = m.atoms.get(b.b);
    return Math.hypot(p.x - q.x, p.y - q.y);
  });
  assert.ok(Math.min(...lens) > 35 && Math.max(...lens) < 65, `bond lengths ${Math.min(...lens)}..${Math.max(...lens)}`);
});

test('invalid SMILES raise a readable error', () => {
  assert.throws(() => parseSmiles('C1CC'), /ring/i);
  assert.throws(() => parseSmiles('C(C'), /branch/i);
  assert.throws(() => parseSmiles('Xx'), /Unexpected/);
});
