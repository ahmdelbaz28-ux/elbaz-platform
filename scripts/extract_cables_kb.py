#!/usr/bin/env python3
"""
ELSEWEDY POWER CABLES KB EXTRACTOR (v3 — final)
Parses LV + MV ampacity tables from "Power Cables.pdf".
Outputs /tmp/pdfwork/kb/elsewedy_tables.json + anomaly report.

Line indexing rule: pdftotext -layout emits \f page feeds; this script splits
on "\n" ONLY so indices match rg/sed conventions (0-based in this file).
"""
import json, os, re

SRC = "/tmp/pdfwork/elsewedy.txt"
OUT_DIR = "/tmp/pdfwork/kb"
os.makedirs(OUT_DIR, exist_ok=True)
lines = open(SRC, encoding="utf-8").read().split("\n")

def page_at(idx, hint):
    for j in range(idx, min(idx + 130, len(lines))):
        m = re.match(r"\s*(\d+)\s+Power Cables Division", lines[j])
        if m:
            return int(m.group(1))
    return hint

STOP_RE = re.compile(
    r"(The above data|Single Core Cables|Multi Core|Multicore Cables|"
    r"^\s*1 Core - |^\s*3 core cables|^\s*4 core cables|^\s*4 core with|^\s*3 Core - |^\s*1 Core - |"
    r"0\.6/1 \(1\.2\) KV|Medium Voltage|Power Cables Division|KV Multi Core|KV Single)"
)

STRIP = {"RM", "SM", "/"}

def parse_lv_row(line, amp_cols, reduced):
    toks = line.split()
    if len(toks) < 6:
        return None
    code = toks[0]
    if not re.match(r"^[CA][PX][SA0-9]", code) or "-" not in code:
        return None
    rest = [t for t in toks[1:] if t not in STRIP]
    nums = []
    for t in rest:
        try:
            nums.append(float(t))
        except ValueError:
            return None
    n = len(nums)
    min_n = (2 if reduced else 1) + 1 + 1 + amp_cols + 2
    if n < min_n:
        return None
    weight, dia = nums[-1], nums[-2]
    amps = nums[-(2 + amp_cols):-2]
    if reduced:
        csa_nums = [nums[0], nums[1]]
        dc, ac = nums[2], nums[4]
    else:
        csa_nums = [nums[0]]
        dc, ac = nums[1], nums[2]
    return {
        "code": code,
        "csa": csa_nums[0],
        "csaLabel": " / ".join(str(int(c)) if c == int(c) else str(c) for c in csa_nums),
        "dc20": dc,
        "ac": ac,
        "amps": amps,
        "dia": dia,
        "weight": weight,
    }

def parse_mv_row(line, amp_cols):
    toks = line.split()
    if len(toks) < 6:
        return None
    code = toks[0]
    if not re.match(r"^[CA]X[A-Z0-9]", code) or "-" not in code:
        return None
    nums = []
    for t in toks[1:]:
        try:
            nums.append(float(t))
        except ValueError:
            return None
    min_n = 1 + 1 + 1 + 2 + amp_cols + 2  # csa dc ac cap ind amps dia weight
    if len(nums) < min_n:
        return None
    amps = nums[-(2 + amp_cols):-2]
    return {
        "code": code,
        "csa": nums[0],
        "csaLabel": str(int(nums[0])) if nums[0] == int(nums[0]) else str(nums[0]),
        "dc20": nums[1],
        "ac": nums[2],
        "capUfKm": nums[3],
        "indMhKm": nums[4],
        "amps": amps,
        "dia": nums[-2],
        "weight": nums[-1],
    }

# (key, header 0-based line, amp cols, col names, parser, page hint)
LV_COLS_SC = ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"]
LV_COLS_MC = ["ground", "duct", "air"]
MV_COLS_SC5 = ["groundFlat", "groundTrefoil", "duct", "airFlatTouched", "airTrefoilTouched"]
MV_COLS_MC3 = ["ground", "duct", "air"]

TABLES = [
    ("sc_cu_pvc", 3489, 6, LV_COLS_SC, "lv", False, 64),
    ("sc_al_pvc", 3545, 6, LV_COLS_SC, "lv", False, 65),
    ("mc3_cu_pvc", 3837, 3, LV_COLS_MC, "lv", False, 71),
    ("mc4_cu_pvc", 3882, 3, LV_COLS_MC, "lv", False, 71),
    ("mc4red_cu_pvc", 3901, 3, LV_COLS_MC, "lv", True, 71),
    ("mc4_al_pvc", 4002, 3, LV_COLS_MC, "lv", False, 73),
    ("mc4red_al_pvc", 4016, 3, LV_COLS_MC, "lv", True, 73),
    ("sc_cu_xlpe", 4539, 6, LV_COLS_SC, "lv", False, 83),
    ("sc_al_xlpe", 4593, 6, LV_COLS_SC, "lv", False, 83),
    ("mc3_cu_xlpe", 4885, 3, LV_COLS_MC, "lv", False, 89),
    ("mc4_cu_xlpe", 4929, 3, LV_COLS_MC, "lv", False, 89),
    ("mc4_al_xlpe", 5049, 3, LV_COLS_MC, "lv", False, 91),
    # MV — 3-core XLPE/PVC unarmoured (Cu + Al), most common distribution cables
    ("mv3_cu_xlpe_36", 6489, 3, MV_COLS_MC3, "mv3", False, 115),
    ("mv3_al_xlpe_36", 6502, 3, MV_COLS_MC3, "mv3", False, 115),
    ("mv3_cu_xlpe_610", 6928, 3, MV_COLS_MC3, "mv3", False, 123),
    ("mv3_al_xlpe_610", 6941, 3, MV_COLS_MC3, "mv3", False, 123),
    ("mv3_cu_xlpe_87", 7364, 3, MV_COLS_MC3, "mv3", False, 124),
    ("mv3_al_xlpe_87", 7377, 3, MV_COLS_MC3, "mv3", False, 124),
    # MV — single-core XLPE/PVC shielded 8.7/15 kV
    ("mv1_cu_xlpe_87", 7294, 5, MV_COLS_SC5, "mv1", False, 124),
    ("mv1_al_xlpe_87", 7309, 5, MV_COLS_SC5, "mv1", False, 124),
]

kb = {}
anomalies = []
for key, hdr, amp_cols, cols, kind, reduced, page_hint in TABLES:
    rows = []
    for i in range(hdr + 1, min(hdr + 90, len(lines))):
        ln = lines[i]
        if rows and STOP_RE.search(ln):
            break
        if not rows and "Power Cables Division" in ln:
            break
        row = parse_lv_row(ln, amp_cols, reduced) if kind == "lv" else parse_mv_row(ln, amp_cols)
        if row:
            row["cols"] = cols
            row["page"] = page_hint
            rows.append(row)
    kb[key] = {"page": page_hint, "reducedNeutral": reduced, "rows": rows}
    for ci in range(amp_cols):
        prev = None
        for r in rows:
            v = r["amps"][ci]
            if prev is not None and v < prev * 0.97:
                anomalies.append(f"{key} col={cols[ci]} csa={r['csa']}: {v} after {prev}")
            prev = v
    if len(rows) < 8:
        anomalies.append(f"{key}: only {len(rows)} rows parsed")

json.dump(kb, open(f"{OUT_DIR}/elsewedy_tables.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
open(f"{OUT_DIR}/anomalies.txt", "w", encoding="utf-8").write("\n".join(anomalies) or "OK")
print("rows:", {k: len(v["rows"]) for k, v in kb.items()})
print("anomalies:")
print("\n".join("  - " + a for a in anomalies) if anomalies else "  none")
