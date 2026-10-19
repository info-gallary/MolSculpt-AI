"""Validate the MolSculpt in-browser chemistry engine against RDKit.

Usage:
    python evaluation/rdkit_compare.py <js_descriptors.json> <out_dir> [tag]

Writes <tag>_comparison.csv, <tag>_summary.json and <tag>_agreement.png.
If the input rows carry `measured_logS`, the ESOL solubility estimate is also
scored against experiment (<tag>_esol.png). Requires: rdkit, matplotlib.
"""
import csv
import json
import math
import statistics
import sys
import time
from pathlib import Path

from rdkit import Chem, RDLogger, rdBase
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors as rd

RDLogger.DisableLog("rdApp.*")

EXACT_KEYS = ["formula", "heavy_atoms", "hbd", "hba", "rotb", "rings", "aromatic_rings"]
FLOAT_KEYS = ["mw", "exact_mass", "tpsa", "logp", "mr", "fsp3"]


def rdkit_values(m):
    return {
        "formula": rd.CalcMolFormula(m),
        "mw": Descriptors.MolWt(m),
        "exact_mass": Descriptors.ExactMolWt(m),
        "heavy_atoms": m.GetNumHeavyAtoms(),
        "hbd": Lipinski.NHOHCount(m),
        "hba": Lipinski.NOCount(m),
        "tpsa": rd.CalcTPSA(m),
        "logp": Crippen.MolLogP(m),
        "mr": Crippen.MolMR(m),
        "rotb": rd.CalcNumRotatableBonds(m),
        "rings": rd.CalcNumRings(m),
        "aromatic_rings": rd.CalcNumAromaticRings(m),
        "fsp3": rd.CalcFractionCSP3(m),
        # The editor draws constitution only, so stereo is ignored in the round trip.
        "canonical": Chem.MolToSmiles(m, isomericSmiles=False),
    }


def regression(xs, ys):
    n = len(xs)
    rmse = math.sqrt(sum((x - y) ** 2 for x, y in zip(xs, ys)) / n)
    mae = sum(abs(x - y) for x, y in zip(xs, ys)) / n
    my = statistics.mean(ys)
    ss_res = sum((y - x) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r = statistics.correlation(xs, ys)
    return {"rmse": round(rmse, 3), "mae": round(mae, 3), "r2": round(1 - ss_res / ss_tot, 3), "pearson_r": round(r, 3)}


def main():
    js_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    tag = sys.argv[3] if len(sys.argv) > 3 else "benchmark"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = json.loads(js_path.read_text())

    table, errors = [], {k: [] for k in FLOAT_KEYS}
    matches = {k: 0 for k in EXACT_KEYS + ["roundtrip"]}
    rdkit_ms, skipped = [], []
    for r in rows:
        m = Chem.MolFromSmiles(r["smiles"])
        if m is None:
            skipped.append(r["name"])
            continue
        reps = 20 if len(rows) < 200 else 3
        t0 = time.perf_counter()
        for _ in range(reps):
            ref = rdkit_values(m)
        rdkit_ms.append((time.perf_counter() - t0) / reps * 1000)
        back = Chem.MolFromSmiles(r["out_smiles"])
        roundtrip = back is not None and Chem.MolToSmiles(back, isomericSmiles=False) == ref["canonical"]
        matches["roundtrip"] += roundtrip
        line = {"name": r["name"], "smiles": r["smiles"], "js_smiles": r["out_smiles"], "roundtrip_ok": roundtrip}
        for k in EXACT_KEYS:
            matches[k] += r[k] == ref[k]
            line[f"js_{k}"], line[f"rdkit_{k}"] = r[k], ref[k]
        for k in FLOAT_KEYS:
            errors[k].append(abs(r[k] - ref[k]))
            line[f"js_{k}"], line[f"rdkit_{k}"] = round(r[k], 4), round(ref[k], 4)
        if "measured_logS" in r:
            line["measured_logS"] = r["measured_logS"]
            line["js_esol_logS"] = round(r["esol_logS"], 4)
            line["published_esol_logS"] = r.get("published_esol_logS")
        table.append(line)

    n = len(table)
    summary = {
        "rdkit_version": rdBase.rdkitVersion,
        "n_input": len(rows),
        "n_compared": n,
        "rdkit_parse_failures": skipped,
        "exact_agreement_pct": {k: round(100 * v / n, 2) for k, v in matches.items()},
        "mean_abs_error": {k: round(statistics.mean(v), 4) for k, v in errors.items()},
        "max_abs_error": {k: round(max(v), 4) for k, v in errors.items()},
        "within_0.01_pct": {k: round(100 * sum(e <= 0.01 for e in v) / n, 2) for k, v in errors.items()},
        "js_mean_analysis_ms": round(statistics.mean(r["analyze_ms"] for r in rows), 3),
        "js_median_analysis_ms": round(statistics.median(r["analyze_ms"] for r in rows), 3),
        "rdkit_mean_descriptor_ms": round(statistics.mean(rdkit_ms), 3),
    }
    if table and "measured_logS" in table[0]:
        meas = [t["measured_logS"] for t in table]
        summary["esol_vs_measured"] = {
            "molsculpt_esol": regression([t["js_esol_logS"] for t in table], meas),
            "published_esol": regression([t["published_esol_logS"] for t in table], meas),
        }

    with open(out_dir / f"{tag}_comparison.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(table[0].keys()))
        w.writeheader()
        w.writerows(table)
    (out_dir / f"{tag}_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))

    mism = [t for t in table if not t["roundtrip_ok"]
            or any(t[f"js_{k}"] != t[f"rdkit_{k}"] for k in EXACT_KEYS)
            or any(abs(t[f"js_{k}"] - t[f"rdkit_{k}"]) > 0.01 for k in FLOAT_KEYS)]
    for t in mism[:40]:
        diffs = {k: (t[f"js_{k}"], t[f"rdkit_{k}"]) for k in EXACT_KEYS + FLOAT_KEYS
                 if (t[f"js_{k}"] != t[f"rdkit_{k}"]) if not isinstance(t[f"js_{k}"], float) or abs(t[f"js_{k}"] - t[f"rdkit_{k}"]) > 0.01}
        print("DIFF", t["name"], t["smiles"], "ROUNDTRIP" if not t["roundtrip_ok"] else "", diffs)
    print(f"{len(mism)} molecules with any difference")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed; skipping plots")
        return

    plt.rcParams.update({"font.family": "serif", "font.size": 8})
    fig, axes = plt.subplots(1, 3, figsize=(7.0, 2.35))
    for ax, key, label in zip(axes, ["logp", "tpsa", "mw"], ["Crippen logP", "TPSA (Å²)", "MW (g/mol)"]):
        xs = [t[f"rdkit_{key}"] for t in table]
        ys = [t[f"js_{key}"] for t in table]
        lo, hi = min(xs + ys), max(xs + ys)
        ax.plot([lo, hi], [lo, hi], color="#9a9a9a", lw=0.8, zorder=1)
        ax.scatter(xs, ys, s=6, color="#1f5f99", alpha=0.75, linewidths=0, zorder=2)
        ax.set_xlabel(f"RDKit {label}")
        ax.set_ylabel(f"MolSculpt {label}")
        ax.set_title(f"n = {n}, MAE = {statistics.mean(errors[key]):.4f}", fontsize=7.5)
    fig.tight_layout()
    fig.savefig(out_dir / f"{tag}_agreement.png", dpi=300)

    if "esol_vs_measured" in summary:
        fig, ax = plt.subplots(figsize=(3.4, 3.0))
        meas = [t["measured_logS"] for t in table]
        pred = [t["js_esol_logS"] for t in table]
        lo, hi = min(meas + pred), max(meas + pred)
        ax.plot([lo, hi], [lo, hi], color="#9a9a9a", lw=0.8)
        ax.scatter(meas, pred, s=5, color="#b5561c", alpha=0.6, linewidths=0)
        st = summary["esol_vs_measured"]["molsculpt_esol"]
        ax.set_xlabel("Measured log S (mol/L)")
        ax.set_ylabel("MolSculpt ESOL log S")
        ax.set_title(f"n = {n}, RMSE = {st['rmse']}, R² = {st['r2']}", fontsize=7.5)
        fig.tight_layout()
        fig.savefig(out_dir / f"{tag}_esol.png", dpi=300)
    print("plots written")


if __name__ == "__main__":
    main()
