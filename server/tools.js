// Tools the agent can call. Each returns compact JSON so tool results stay
// small in the LLM context. Chemistry is computed with the same engine the
// browser uses; identity, similarity and safety data come from PubChem.

import { analyzeSmiles, summarize } from '../public/js/chem/index.js';
import { lookupBySmiles, similarCompounds, ghsSafety } from './pubchem.js';

const smilesParam = { type: 'string', description: 'SMILES of the molecule (use the SMILES given by the user unless asked otherwise)' };

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'compute_descriptors',
      description: 'Compute physicochemical descriptors with the local cheminformatics engine (validated against RDKit): formula, MW, Crippen logP, TPSA, H-bond donors/acceptors, rotatable bonds, rings, Fsp3, ESOL solubility and functional groups.',
      parameters: { type: 'object', properties: { smiles: smilesParam }, required: ['smiles'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pubchem_lookup',
      description: 'Identify the exact structure in PubChem. Returns found=false when the structure is not registered (possibly novel). When found: CID, common name, IUPAC name, XLogP, synonyms and curated text descriptions.',
      parameters: { type: 'object', properties: { smiles: smilesParam }, required: ['smiles'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_similar_compounds',
      description: 'Find structurally similar known compounds in PubChem (2D Tanimoto similarity). Useful for novel structures to infer likely activity or class by analogy.',
      parameters: {
        type: 'object',
        properties: { smiles: smilesParam, threshold: { type: 'integer', description: 'Tanimoto similarity threshold in percent (70-99), default 85' } },
        required: ['smiles'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_structural_alerts',
      description: 'Screen for toxicophores, reactive groups and PAINS-like motifs (Brenk/PAINS-inspired SMARTS rules). Returns each alert with severity and rationale.',
      parameters: { type: 'object', properties: { smiles: smilesParam }, required: ['smiles'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_drug_likeness',
      description: 'Evaluate Lipinski rule of five, Veber, Egan, Ghose and lead-likeness filters and give an overall drug-likeness verdict.',
      parameters: { type: 'object', properties: { smiles: smilesParam }, required: ['smiles'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_safety_data',
      description: 'Retrieve GHS hazard classification (signal word and H-statements) for a PubChem compound. Requires a CID from pubchem_lookup.',
      parameters: { type: 'object', properties: { cid: { type: 'integer', description: 'PubChem CID' } }, required: ['cid'] },
    },
  },
];

export function drugLikenessVerdict(result) {
  const r = result.descriptors.rules;
  const highAlerts = result.alerts.filter((a) => a.severity === 'high').length;
  const failed = ['lipinski', 'veber', 'egan'].filter((k) => !r[k].pass);
  let verdict = 'Drug-like';
  if (failed.length >= 2 || highAlerts >= 1) verdict = 'Not drug-like';
  else if (failed.length === 1 || result.alerts.some((a) => a.severity === 'medium')) verdict = 'Borderline';
  return { verdict, failed_filters: failed, high_severity_alerts: highAlerts };
}

function rulesView(rules) {
  return Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, {
    pass: v.pass,
    ...(v.violations !== undefined ? { violations: v.violations } : {}),
    failed: v.details.filter((d) => !d.ok).map((d) => d.rule),
  }]));
}

const parse = (smiles) => {
  if (typeof smiles !== 'string' || !smiles.trim()) throw new Error('smiles is required');
  return analyzeSmiles(smiles.trim());
};

export async function executeTool(name, args) {
  switch (name) {
    case 'compute_descriptors':
      return summarize(parse(args.smiles));
    case 'pubchem_lookup':
      parse(args.smiles);
      return lookupBySmiles(args.smiles.trim());
    case 'find_similar_compounds': {
      parse(args.smiles);
      const hits = await similarCompounds(args.smiles.trim(), args.threshold ?? 85);
      return { count: hits.length, compounds: hits };
    }
    case 'check_structural_alerts': {
      const res = parse(args.smiles);
      return {
        count: res.alerts.length,
        alerts: res.alerts.map((a) => ({ name: a.name, severity: a.severity, occurrences: a.count, rationale: a.why })),
      };
    }
    case 'assess_drug_likeness': {
      const res = parse(args.smiles);
      return { ...drugLikenessVerdict(res), filters: rulesView(res.descriptors.rules) };
    }
    case 'get_safety_data':
      if (!Number.isInteger(Number(args.cid)) || Number(args.cid) <= 0) throw new Error('valid cid required');
      return ghsSafety(Number(args.cid));
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/** One-line human summary of a tool result for the UI trace. */
export function summarizeToolResult(name, result) {
  if (!result) return 'no data';
  switch (name) {
    case 'compute_descriptors':
      return `${result.formula}, MW ${result.molecular_weight}, logP ${result.clogp_crippen}, TPSA ${result.tpsa_A2} Å²`;
    case 'pubchem_lookup':
      return result.found ? `Found: ${result.title ?? 'CID ' + result.cid} (CID ${result.cid})` : 'Not in PubChem: possibly a novel structure';
    case 'find_similar_compounds':
      return result.count ? `${result.count} analogues, e.g. ${result.compounds.slice(0, 3).map((c) => c.title).join(', ')}` : 'No close analogues';
    case 'check_structural_alerts':
      return result.count ? result.alerts.map((a) => `${a.name} (${a.severity})`).join(', ') : 'No structural alerts';
    case 'assess_drug_likeness':
      return `${result.verdict}; Lipinski violations ${result.filters.lipinski.violations}`;
    case 'get_safety_data':
      return result.available
        ? `Hazard level ${result.hazard_level}; ${result.predominant_hazards.length} predominant of ${result.hazard_statements.length} GHS statements`
        : 'No GHS data';
    default:
      return 'done';
  }
}
