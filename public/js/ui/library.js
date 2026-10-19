// Molecule library (RDKit-depicted templates) and SMILES import.

import { Molecule } from '../chem/molecule.js';
import { parseSmiles } from '../chem/index.js';
import { TEMPLATES } from '../data/templates.js';
import { drawThumbnail } from './renderer.js';
import { toast, earcon } from './feedback.js';
import { el } from './properties.js';

const $ = (id) => document.getElementById(id);

export function templateToMolecule(t) {
  const m = new Molecule();
  const ids = t.atoms.map(([elSym, x, y, charge]) => m.addAtom(elSym, x, y, { charge }).id);
  for (const [a, b, order] of t.bonds) m.addBond(ids[a], ids[b], order);
  return m;
}

export class Library {
  constructor(editor, openDialog, closeDialog) {
    this.editor = editor;
    this.open = openDialog;
    this.close = closeDialog;
    this.built = false;
    $('btn-import').addEventListener('click', () => this.importSmiles());
    $('smiles-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.importSmiles(); } });
  }

  show() {
    this.open('dlg-library');
    if (!this.built) this.build();
    $('smiles-input').focus();
  }

  build() {
    const dark = document.documentElement.dataset.theme === 'dark'
      || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    const byCat = new Map();
    for (const t of TEMPLATES) {
      if (!byCat.has(t.category)) byCat.set(t.category, []);
      byCat.get(t.category).push(t);
    }
    const sections = [];
    for (const [cat, list] of byCat) {
      const grid = el('div', { class: 'grid' });
      for (const t of list) {
        const canvas = el('canvas');
        const card = el('button', { type: 'button', class: 'tpl', 'data-dwell': '', title: t.smiles }, canvas, el('b', { text: t.name }), el('span', { text: t.note }));
        card.addEventListener('click', () => this.load(t));
        grid.append(card);
        requestAnimationFrame(() => drawThumbnail(canvas,
          t.atoms.map(([e, x, y]) => ({ el: e, x, y })),
          t.bonds.map(([a, b, order]) => ({ a, b, order })), { dark }));
      }
      sections.push(el('h3', { text: cat }), grid);
    }
    $('library-grid').replaceChildren(...sections);
    this.built = true;
  }

  load(t) {
    this.editor.loadMolecule(templateToMolecule(t), 'load-template', { name: t.name });
    this.close('dlg-library');
    toast(`Loaded ${t.name}`);
    earcon('place');
  }

  importSmiles() {
    const text = $('smiles-input').value.trim();
    const err = $('import-error');
    if (!text) return;
    try {
      this.editor.loadMolecule(parseSmiles(text), 'import-smiles', { smiles: text });
      err.hidden = true;
      this.close('dlg-library');
      toast('SMILES imported');
      earcon('place');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      earcon('error');
    }
  }
}
