"""Convert the public ESOL / Delaney solubility CSV (MoleculeNet copy) to the
benchmark JSON format used by compute_js.mjs.

Source: J. S. Delaney, J. Chem. Inf. Comput. Sci. 44 (2004) 1000-1005, via
https://deepchemdata.s3-us-west-1.amazonaws.com/datasets/delaney-processed.csv

Usage: python evaluation/prepare_esol.py delaney-processed.csv evaluation/data/esol_delaney.json
"""
import csv
import json
import sys

rows = []
with open(sys.argv[1], newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rows.append({
            "name": r["Compound ID"].strip(),
            "smiles": r["smiles"].strip(),
            "measured_logS": float(r["measured log solubility in mols per litre"]),
            "published_esol_logS": float(r["ESOL predicted log solubility in mols per litre"]),
        })

with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(rows, f, indent=1)
print(f"{len(rows)} molecules written to {sys.argv[2]}")
