"""Column-width plots for the term paper from the RDKit comparison CSV.
Usage: python paper/make_plots.py evaluation/results/esol_comparison.csv paper/figures
"""
import csv
import statistics
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
out = Path(sys.argv[2])
plt.rcParams.update({"font.family": "serif", "font.serif": ["Times New Roman", "DejaVu Serif"], "font.size": 8})

f = lambda k: [float(r[k]) for r in rows]

fig, axes = plt.subplots(1, 2, figsize=(3.45, 1.85))
for ax, key, label in zip(axes, ["logp", "tpsa"], ["Crippen logP", "TPSA (Å²)"]):
    x, y = f(f"rdkit_{key}"), f(f"js_{key}")
    lo, hi = min(x + y), max(x + y)
    ax.plot([lo, hi], [lo, hi], color="#999", lw=0.7, zorder=1)
    ax.scatter(x, y, s=3, color="#1f5f99", alpha=0.7, linewidths=0, zorder=2)
    mae = statistics.mean(abs(a - b) for a, b in zip(x, y))
    ax.set_title(f"{label}: MAE {mae:.4f}", fontsize=7.5)
    ax.set_xlabel("RDKit", fontsize=7.5)
    ax.set_ylabel("MolSculpt", fontsize=7.5)
    ax.tick_params(labelsize=6.5)
fig.tight_layout(pad=0.4)
fig.savefig(out / "plot-agreement.png", dpi=400)

fig, ax = plt.subplots(figsize=(3.45, 2.2))
meas, pred, pub = f("measured_logS"), f("js_esol_logS"), f("published_esol_logS")
lo, hi = min(meas + pred), max(meas + pred)
ax.plot([lo, hi], [lo, hi], color="#999", lw=0.7)
ax.scatter(meas, pred, s=3, color="#b5561c", alpha=0.55, linewidths=0, label="MolSculpt ESOL (Crippen logP)")
ax.set_xlabel("Measured log S (mol/L)", fontsize=7.5)
ax.set_ylabel("Predicted log S", fontsize=7.5)
ax.tick_params(labelsize=6.5)
rmse = (sum((a - b) ** 2 for a, b in zip(meas, pred)) / len(meas)) ** 0.5
ax.set_title(f"n = {len(meas)}, RMSE = {rmse:.2f} log units", fontsize=7.5)
fig.tight_layout(pad=0.4)
fig.savefig(out / "plot-esol.png", dpi=400)
print("plots written")
