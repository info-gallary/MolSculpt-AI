// Thin PubChem PUG-REST / PUG-View client with timeouts and an in-memory cache.
// SMILES are always sent in a POST body so characters such as '#', '/' and
// '\' never need URL escaping.

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const VIEW = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';
const TIMEOUT_MS = 9000;
const cache = new Map();
const TTL_MS = 30 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
}

async function request(url, { smiles } = {}) {
  const init = { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } };
  if (smiles !== undefined) {
    init.method = 'POST';
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams({ smiles }).toString();
  }
  const res = await fetch(url, init);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PubChem HTTP ${res.status}`);
  return res.json();
}

function trimToSentence(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const PROPS = 'Title,IUPACName,MolecularFormula,MolecularWeight,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,InChIKey';

export function lookupBySmiles(smiles) {
  return cached(`lookup:${smiles}`, async () => {
    const data = await request(`${BASE}/compound/smiles/property/${PROPS}/JSON`, { smiles });
    let p = data?.PropertyTable?.Properties?.[0];
    if (!p || !p.CID) return { found: false };
    // The SMILES lookup can land on a tautomer/duplicate record (e.g. a record
    // titled "[14C]metformin" for plain metformin). Resolve to the lowest CID
    // sharing the InChIKey, which is the parent record.
    if (p.InChIKey) {
      try {
        const ids = await request(`${BASE}/compound/inchikey/${p.InChIKey}/cids/JSON`);
        const parent = Math.min(...(ids?.IdentifierList?.CID ?? [p.CID]));
        if (parent < p.CID) {
          const better = await request(`${BASE}/compound/cid/${parent}/property/${PROPS}/JSON`);
          p = better?.PropertyTable?.Properties?.[0] ?? p;
        }
      } catch { /* keep the first match */ }
    }
    const cid = p.CID;
    const [syn, desc] = await Promise.allSettled([
      request(`${BASE}/compound/cid/${cid}/synonyms/JSON`),
      request(`${BASE}/compound/cid/${cid}/description/JSON`),
    ]);
    const synonyms = syn.status === 'fulfilled'
      ? (syn.value?.InformationList?.Information?.[0]?.Synonym ?? []).filter((s) => s.length < 60 && !/^\d|[A-Z0-9]{8,}/.test(s)).slice(0, 8)
      : [];
    const descriptions = desc.status === 'fulfilled'
      ? (desc.value?.InformationList?.Information ?? [])
        .filter((d) => d.Description)
        .slice(0, 3)
        .map((d) => ({ source: d.DescriptionSourceName, text: trimToSentence(d.Description, 500) }))
      : [];
    return {
      found: true,
      cid,
      title: p.Title ?? null,
      iupac_name: p.IUPACName ?? null,
      formula: p.MolecularFormula ?? null,
      molecular_weight: p.MolecularWeight ? Number(p.MolecularWeight) : null,
      xlogp: p.XLogP ?? null,
      tpsa: p.TPSA ?? null,
      hbd: p.HBondDonorCount ?? null,
      hba: p.HBondAcceptorCount ?? null,
      inchikey: p.InChIKey ?? null,
      synonyms,
      descriptions,
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    };
  });
}

export function similarCompounds(smiles, threshold = 90, max = 5) {
  const t = Math.min(99, Math.max(70, Math.round(threshold)));
  return cached(`sim:${t}:${smiles}`, async () => {
    const data = await request(`${BASE}/compound/fastsimilarity_2d/smiles/cids/JSON?Threshold=${t}&MaxRecords=${max + 1}`, { smiles });
    const cids = data?.IdentifierList?.CID ?? [];
    if (!cids.length) return [];
    const props = await request(`${BASE}/compound/cid/${cids.join(',')}/property/Title,MolecularFormula,MolecularWeight/JSON`);
    return (props?.PropertyTable?.Properties ?? []).map((p) => ({
      cid: p.CID,
      title: p.Title ?? `CID ${p.CID}`,
      formula: p.MolecularFormula,
      molecular_weight: p.MolecularWeight ? Number(p.MolecularWeight) : null,
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
    }));
  });
}

// Fatal/toxic, corrosive, CMR (carcinogenic, mutagenic, reprotoxic) and
// organ-damage codes count as high; other health/physical codes as moderate.
const HIGH_CODES = /^H(200|201|202|203|240|241|300|301|310|311|314|318|330|331|340|341|350|351|360|361|370|372)/;
export function hazardLevel(statements) {
  if (!statements.length) return 'unknown';
  if (statements.some((s) => HIGH_CODES.test(s))) return 'high';
  if (statements.some((s) => /^H[23]\d\d/.test(s))) return 'moderate';
  return 'low';
}

export function ghsSafety(cid) {
  return cached(`ghs:${cid}`, async () => {
    const data = await request(`${VIEW}/data/compound/${Number(cid)}/JSON?heading=GHS+Classification`);
    if (!data) return { available: false };
    const strings = [];
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') {
        for (const [k, v] of Object.entries(x)) {
          if (k === 'String' && typeof v === 'string') strings.push(v);
          else walk(v);
        }
      }
    };
    walk(data);
    const signal = strings.includes('Danger') ? 'Danger' : strings.includes('Warning') ? 'Warning' : null;
    // PubChem aggregates every notifier; "H302 (95.6%): ..." gives the share of
    // notifications reporting that hazard. Keep one entry per H-code with its
    // highest share; predominant = reported by >= 50% (or, when no shares are
    // given at all, every listed code).
    const byCode = new Map();
    for (const s of strings) {
      const m = /^(H\d{3}[A-Za-z]*)\s*(?:\((\d+(?:\.\d+)?)%\))?:?\s*(.*)$/.exec(s);
      if (!m) continue;
      const [, code, pct, text] = m;
      const prev = byCode.get(code);
      const share = pct === undefined ? null : Number(pct);
      if (!prev || (share !== null && (prev.share === null || share > prev.share))) {
        byCode.set(code, { code, share, text: text.replace(/\s*\[.*$/, '').trim() || prev?.text || '' });
      }
    }
    const entries = [...byCode.values()];
    const anyShare = entries.some((e) => e.share !== null);
    const label = (e) => `${e.code}${e.share !== null ? ` (${e.share}%)` : ''}: ${e.text}`;
    const predominant = entries.filter((e) => (anyShare ? (e.share ?? 0) >= 50 : true)).map(label);
    return {
      available: entries.length > 0 || signal !== null,
      signal_word_any_notifier: signal,
      hazard_statements: entries.slice(0, 12).map(label),
      predominant_hazards: predominant,
      hazard_level: hazardLevel(predominant),
    };
  });
}
