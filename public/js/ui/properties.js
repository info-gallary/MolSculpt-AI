// Live properties panel. Updates on every edit (the engine takes ~1 ms), so
// the consequence of each gesture is visible immediately. Hovering a
// functional group or alert highlights its atoms on the canvas.

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
}

const fmt = (v, k = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(k));

export class PropertiesPanel {
  constructor(editor) {
    this.editor = editor;
    editor.addEventListener('change', () => this.render());
    this.render();
  }

  bindHighlight(node, atomLists) {
    const ids = new Set(atomLists.flat());
    const on = () => { this.editor.highlight = { atoms: ids }; this.editor.render(); };
    const off = () => { this.editor.highlight = null; this.editor.render(); };
    node.addEventListener('mouseenter', on);
    node.addEventListener('mouseleave', off);
    node.addEventListener('hand-enter', on);
    node.addEventListener('hand-leave', off);
    node.addEventListener('focus', on);
    node.addEventListener('blur', off);
  }

  render() {
    const res = this.editor.analysis;
    const d = res.descriptors;
    $('empty-hint').hidden = !res.empty;

    if (res.empty) {
      $('p-formula').textContent = '—';
      $('p-mw').textContent = 'Draw a molecule to see its properties';
      $('p-smiles').textContent = '';
      for (const id of ['p-problems', 'p-rules', 'p-desc', 'p-groups', 'p-alerts']) $(id).replaceChildren();
      return;
    }

    $('p-formula').innerHTML = d.formulaHtml; // built from element symbols and integers only
    $('p-mw').textContent = `${fmt(d.molecularWeight)} g/mol · exact mass ${fmt(d.exactMass, 4)}`;
    $('p-smiles').textContent = res.smiles;

    const problems = [
      ...res.problems.map((p) => el('div', { class: 'problem', text: `⚠ ${p.message}` })),
      ...res.notes.map((n) => el('div', { class: 'note', text: n })),
    ];
    $('p-problems').replaceChildren(...problems);

    const rules = [
      ['Lipinski Ro5', d.rules.lipinski, `${d.rules.lipinski.violations} violation(s)`],
      ['Veber', d.rules.veber, 'oral bioavailability'],
      ['Egan', d.rules.egan, 'absorption'],
      ['Ghose', d.rules.ghose, 'drug-like ranges'],
      ['Lead-like', d.rules.leadLike, 'lead optimisation'],
    ];
    $('p-rules').replaceChildren(...rules.map(([name, r, sub]) => {
      const failed = r.details.filter((x) => !x.ok).map((x) => x.rule);
      return el('div', { class: `rule ${r.pass ? 'pass' : 'fail'}`, title: failed.length ? `Fails: ${failed.join(', ')}` : 'All criteria met' },
        el('b', { text: name }), el('span', { text: failed.length ? failed.join(' · ') : sub }));
    }));

    const rows = [
      ['cLogP (Crippen)', fmt(d.logP)],
      ['TPSA', `${fmt(d.tpsa, 1)} Å²`],
      ['H-bond donors', d.hbd],
      ['H-bond acceptors', d.hba],
      ['Rotatable bonds', d.rotatableBonds],
      ['Rings / aromatic', `${d.rings} / ${d.aromaticRings}`],
      ['Heavy atoms', d.heavyAtoms],
      ['Fraction Csp3', fmt(d.fractionCsp3)],
      ['Molar refractivity', fmt(d.molarRefractivity, 1)],
      ['Solubility (ESOL)', `${fmt(d.esolLogS)} · ${d.solubilityClass}`],
      ['Formal charge', d.charge > 0 ? `+${d.charge}` : d.charge],
    ];
    if (d.doubleBondEquivalents !== null) rows.push(['Unsaturation (DBE)', d.doubleBondEquivalents]);
    $('p-desc').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })]));

    const chips = res.groups.map((g) => {
      const b = el('button', { type: 'button', class: g.ring ? 'ring-chip' : '', text: g.count > 1 ? `${g.name} ×${g.count}` : g.name });
      this.bindHighlight(b, g.atoms);
      return b;
    });
    $('p-groups').replaceChildren(...(chips.length ? chips : [el('span', { class: 'muted small', text: 'Only C–C / C–H bonds' })]));

    const alerts = res.alerts.map((a) => {
      const node = el('div', { class: `alert ${a.severity}`, tabindex: '0' },
        el('b', { text: `${a.name} · ${a.severity}` }), el('span', { text: a.why }));
      this.bindHighlight(node, a.atoms);
      return node;
    });
    $('p-alerts').replaceChildren(...(alerts.length ? alerts : [el('span', { class: 'muted small', text: 'No toxicophore or PAINS-like alerts found' })]));
  }
}

export { el };
