#!/usr/bin/env python3
"""
GENERATOR for api/lib/chatbot-cables-kb.ts — Elsewedy Power Cables knowledge base.

Sources (all verified cell-by-cell):
  - /tmp/pdfwork/kb/elsewedy_tables.json  (LV/MV ampacity — scripts/extract_cables_kb.py)
  - /tmp/pdfwork/elsewedy.txt             (pdftotext -layout dump of "Power Cables.pdf")
    → Tables 14-19 (short-circuit, voltage drop), 21-22 (AWG, Cu↔Al) parsed programmatically.
  - Derating tables 3-13 + selection factors: transcribed from the same dump
    (verified against the catalogue pages in this run; suspect cells flagged).

Re-run: python3 scripts/gen_cables_kb_ts.py   (after extract_cables_kb.py)
"""
import json, re, os

TXT = "/tmp/pdfwork/elsewedy.txt"
JSON_PATH = "/tmp/pdfwork/kb/elsewedy_tables.json"
OUT = "/home/z/my-project/elbaz-platform/api/lib/chatbot-cables-kb.ts"

lines = open(TXT, encoding="utf-8").read().split("\n")
amp = json.load(open(JSON_PATH, encoding="utf-8"))

# ─────────────────────────── generic numeric-table parser ───────────────────────────

def numeric_rows(start, end, min_cols, max_cols=12):
    """Rows of pure numbers between 1-based line bounds (inclusive)."""
    rows = []
    for i in range(start - 1, min(end, len(lines))):
        toks = lines[i].split()
        if not toks:
            continue
        try:
            nums = [float(t) for t in toks]
        except ValueError:
            continue
        if min_cols <= len(nums) <= max_cols:
            rows.append(nums)
    return rows

def rows_by_key(rows, key_col=0):
    d = {}
    for r in rows:
        key = int(r[key_col]) if r[key_col] == int(r[key_col]) else r[key_col]
        d[key] = r[key_col + 1:]
    return d

# Tables 14-17 (short circuit kA): csa + 10 durations
sc_rows = numeric_rows(1043, 1164, 11, 11)
SC = {
    "cu_pvc": rows_by_key(numeric_rows(1043, 1067, 11, 11)),
    "cu_xlpe": rows_by_key(numeric_rows(1071, 1102, 11, 11)),
    "al_pvc": rows_by_key(numeric_rows(1106, 1130, 11, 11)),
    "al_xlpe": rows_by_key(numeric_rows(1134, 1164, 11, 11)),
}
SC_DURATIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 3, 4, 5]

# Table 18 (single core VD): csa + 4 values
vd18_cu = rows_by_key(numeric_rows(1173, 1191, 5, 5))
vd18_al = rows_by_key(numeric_rows(1199, 1214, 5, 5))
# Table 19 (multicore VD): csa + 2 values
vd19_cu = rows_by_key(numeric_rows(1235, 1253, 3, 3))
vd19_al = rows_by_key(numeric_rows(1260, 1273, 3, 3))

# Table 21 AWG + Table 22 Cu/Al (curated — verified against dump lines 1358-1440)
AWG = [(30, 0.05), (28, 0.08), (26, 0.14), (24, 0.25), (22, 0.34), (21, 0.38), (20, 0.5),
       (18, 0.75), (17, 1.0), (16, 1.5), (14, 2.5), (12, 4.0), (10, 6.0), (8, 10.0),
       (6, 16.0), (4, 25.0), (2, 35.0), (1, 50.0)]
AWG_MCM = [("2/0", 70), ("3/0", 95), ("4/0", 120), ("300MCM", 150), ("350MCM", 185),
           ("500MCM", 240), ("600MCM", 300), ("750MCM", 400), ("1000MCM", 500)]
CU_AL = [(10, 25), (16, 35), (25, 50), (35, 70), (50, 95), (70, 120), (95, 150), (120, 185),
         (150, 240), (185, 300), (240, 400), (300, 500), (400, 630), (500, 800),
         (630, 1000), (800, 1200), (1000, 1400), (1200, 1600)]

# sanity checks on parsed tables
assert 800 in SC["cu_xlpe"] and abs(SC["cu_xlpe"][800][5] - 114.5) < 0.05, "SC cu_xlpe 800mm/1s mismatch"
assert 500 in vd18_cu and abs(vd18_cu[500][0] - 0.208) < 0.001, "VD18 cu 500 PVC flat mismatch"
assert len(vd18_cu) == 17 and len(vd18_al) == 14, f"VD18 row counts wrong: {len(vd18_cu)}/{len(vd18_al)}"
assert len(vd19_cu) == 17 and len(vd19_al) == 12, f"VD19 row counts wrong: {len(vd19_cu)}/{len(vd19_al)}"
assert 16 in vd19_al and abs(vd19_al[16][0] - 3.263) < 0.001, "VD19 al 16 PVC mismatch"
assert 1.5 in SC["cu_pvc"] and abs(SC["cu_pvc"][1.5][0] - 0.5) < 0.05, "SC cu_pvc 1.5 mismatch"

# ─────────────────────────── curated derating tables (3-13) ───────────────────────────

AIR_TEMPS = [15, 20, 25, 30, 35, 40, 45, 50, 55]
T3_AIR = {"pvc70": [1.21, 1.15, 1.07, 1.0, 0.92, 0.84, 0.75, 0.66, 0.55],
          "xlpe90": [1.15, 1.10, 1.05, 1.0, 0.95, 0.90, 0.84, 0.78, 0.72]}
T4_GROUND = {"pvc70": [1.05, 1.0, 0.95, 0.89, 0.84, 0.77, 0.71, 0.63, 0.55],
             "xlpe90": [1.04, 1.0, 0.96, 0.93, 0.89, 0.85, 0.80, 0.76, 0.71]}
T5_DEPTHS = [0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
T5_DEPTH = {
    "direct_sc_le185": [1.0, 0.98, 0.96, 0.94, 0.92, 0.91, 0.90, 0.89, 0.88, 0.87],
    "direct_sc_gt185": [1.0, 0.98, 0.94, 0.92, 0.90, 0.88, 0.86, 0.85, 0.83, 0.81],
    "direct_3c":       [1.0, 0.99, 0.96, 0.94, 0.92, 0.91, 0.90, 0.89, 0.88, 0.87],
    "duct_sc_le185":   [1.0, 0.98, 0.96, 0.94, 0.92, 0.91, 0.90, 0.89, 0.88, 0.87],
    "duct_sc_gt185":   [1.0, 0.98, 0.95, 0.92, 0.90, 0.89, 0.88, 0.87, 0.85, 0.84],
    "duct_3c":         [1.0, 0.99, 0.97, 0.96, 0.94, 0.93, 0.92, 0.91, 0.90, 0.89],
}
T6_SOIL_K = [0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0]
T6_SOIL_F = [1.1, 1.05, 1.0, 0.92, 0.83, 0.73, 0.66, 0.6]
T7_PVC_RATED = [70, 90, 105]
T7_PVC = {"ground": [1.0, 1.15, 1.24], "air": [1.0, 1.28, 1.46], "duct": [1.0, 1.20, 1.34]}
T8_CIRCUITS = [2, 3, 4, 5, 6]
T8_SINGLE_GROUND = {
    "trefoilTouching": [0.77, 0.66, 0.60, 0.56, 0.53],
    "flatTouching":    [0.80, 0.69, 0.63, 0.59, 0.57],
    "trefoilS15":      [0.82, 0.73, 0.68, 0.64, 0.61],
    "flatS15":         [0.85, 0.76, 0.71, 0.67, 0.64],
    "trefoilS30":      [0.88, 0.80, 0.74, 0.72, 0.70],
    "flatS30":         [0.91, 0.83, 0.77, 0.75, 0.73],
}
T9_MULTICORE_GROUND = {
    "trefoilTouching": [0.81, 0.69, 0.62, 0.58, 0.54],
    "flatTouching":    [0.81, 0.70, 0.63, 0.60, 0.56],
    "trefoilS15":      [0.87, 0.76, 0.72, 0.66, 0.63],
    "flatS15":         [0.87, 0.78, 0.74, 0.70, 0.67],
    "trefoilS30":      [0.91, 0.82, 0.77, 0.73, 0.70],
    "flatS30":         [0.91, 0.84, 0.81, 0.78, 0.76],
}
T10_CABLES = [1, 2, 3, 4, 6, 9]
T10_MULTICORE_AIR = {
    "perforatedTouching": {"t1": [1.00, 0.88, 0.82, 0.79, 0.76, 0.73], "t2": [1.00, 0.87, 0.80, 0.77, 0.73, 0.68], "t3": [1.00, 0.86, 0.79, 0.76, 0.71, 0.66]},
    "perforatedSpaced":   {"t1": [1.00, 1.00, 0.98, 0.95, 0.91, None], "t2": [1.00, 0.99, 0.96, 0.92, 0.87, None], "t3": [1.00, 0.98, 0.95, 0.91, 0.85, None]},
    "ladderTouching":     {"t1": [1.00, 0.88, 0.82, 0.78, 0.73, 0.72], "t2": [1.00, 0.88, 0.81, 0.76, 0.71, 0.70], "t3": None},
    "ladderSpaced":       {"t1": [1.00, 0.91, 0.89, 0.88, 0.87, None], "t2": [1.00, 0.91, 0.88, 0.87, 0.85, None], "t3": None},
    "verticalTouching":   {"t1": [1.00, 0.87, 0.82, 0.80, 0.79, 0.78], "t2": [1.00, 0.86, 0.80, 0.78, 0.76, 0.73], "t3": [1.00, 0.85, 0.79, 0.76, 0.73, 0.70]},
    "verticalSpaced":     {"t1": [1.00, 1.00, 1.00, 1.00, 1.00, None], "t2": [1.00, 0.99, 0.98, 0.97, 0.96, None], "t3": [1.00, 0.98, 0.97, 0.96, 0.93, None]},
}
T11_SINGLE_AIR = {
    "perforatedHorizontal": {"t1": [0.98, 0.91, 0.87], "t2": [0.96, 0.87, 0.81], "t3": [0.95, 0.85, 0.78]},
    "ladderHorizontal":     {"t1": [1.00, 0.97, 0.96], "t2": [0.98, 0.93, 0.89], "t3": [0.97, 0.90, 0.86]},
    "perforatedTrefoil":    {"t1": [1.00, 0.98, 0.96], "t2": [0.97, 0.93, 0.98], "t3": [0.96, 0.92, 0.86]},
    "verticalTrefoil":      {"t1": [1.00, 0.91, 0.89], "t2": [1.00, 0.90, 0.80], "t3": None},
    "ladderTrefoil":        {"t1": [1.00, 1.00, 1.00], "t2": [0.97, 0.95, 0.93], "t3": [0.96, 0.94, 0.90]},
}
T11_SUSPECT = [("perforatedTrefoil", "t2", 2, "0.98 مطبوعة بالكتالوج وتكسر الاتساق مع مجاورتها (0.93 عند 2 كابلات و0.86/0.92 عند 3 رفوف) — تُعامل بالمقابل الأدنى عند الاستخدام")]

def f(v):
    if v is None:
        return "null"
    return repr(round(v, 6))

def arr(vals):
    return "[" + ", ".join("null" if v is None else str(round(v, 6)) for v in vals) + "]"

def obj(vals_map):
    return "{\n" + ",\n".join(f'    {k}: {arr(v)}' for k, v in vals_map.items()) + "\n  }"

def obj_t10(m):
    out = []
    for method, trays in m.items():
        parts = []
        for tk in ["t1", "t2", "t3"]:
            parts.append(f'    {tk}: {arr(trays[tk]) if trays[tk] else "null"}')
        out.append(f'  {method}: {{\n' + ",\n".join(parts) + "\n  }")
    return "{\n" + ",\n".join(out) + "\n}"

# ─────────────────────────── ampacity tables TS ───────────────────────────

AMPACITY_DEFS = [
    ("sc_cu_pvc",    "single", "cu", "pvc", "0.6/1 kV Single Core Cu/PVC/PVC — 1 Core", 64, ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"]),
    ("sc_al_pvc",    "single", "al", "pvc", "0.6/1 kV Single Core AL/PVC/PVC — 1 Core", 65, ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"]),
    ("mc3_cu_pvc",   "multi3", "cu", "pvc", "0.6/1 kV 3-Core Cu/PVC/PVC Unarmoured", 71, ["ground", "duct", "air"]),
    ("mc4_cu_pvc",   "multi4", "cu", "pvc", "0.6/1 kV 4-Core Cu/PVC/PVC Unarmoured", 71, ["ground", "duct", "air"]),
    ("mc4red_cu_pvc","multi4red", "cu", "pvc", "0.6/1 kV 4-Core Reduced Neutral Cu/PVC/PVC", 71, ["ground", "duct", "air"]),
    ("mc4_al_pvc",   "multi4", "al", "pvc", "0.6/1 kV 4-Core AL/PVC/PVC Unarmoured", 73, ["ground", "duct", "air"]),
    ("mc4red_al_pvc","multi4red", "al", "pvc", "0.6/1 kV 4-Core Reduced Neutral AL/PVC/PVC", 73, ["ground", "duct", "air"]),
    ("sc_cu_xlpe",   "single", "cu", "xlpe", "0.6/1 kV Single Core Cu/XLPE/PVC — 1 Core", 83, ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"]),
    ("sc_al_xlpe",   "single", "al", "xlpe", "0.6/1 kV Single Core AL/XLPE/PVC — 1 Core", 83, ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"]),
    ("mc3_cu_xlpe",  "multi3", "cu", "xlpe", "0.6/1 kV 3-Core Cu/XLPE/PVC Unarmoured", 89, ["ground", "duct", "air"]),
    ("mc4_cu_xlpe",  "multi4", "cu", "xlpe", "0.6/1 kV 4-Core Cu/XLPE/PVC Unarmoured", 89, ["ground", "duct", "air"]),
    ("mc4_al_xlpe",  "multi4", "al", "xlpe", "0.6/1 kV 4-Core AL/XLPE/PVC Unarmoured", 91, ["ground", "duct", "air"]),
    ("mv3_cu_xlpe_36","mv3", "cu", "xlpe", "3.6/6 (7.2) kV 3-Core Cu/XLPE/PVC", 115, ["ground", "duct", "air"]),
    ("mv3_al_xlpe_36","mv3", "al", "xlpe", "3.6/6 (7.2) kV 3-Core AL/XLPE/PVC", 115, ["ground", "duct", "air"]),
    ("mv3_cu_xlpe_610","mv3", "cu", "xlpe", "6/10 (12) kV 3-Core Cu/XLPE/PVC", 123, ["ground", "duct", "air"]),
    ("mv3_al_xlpe_610","mv3", "al", "xlpe", "6/10 (12) kV 3-Core AL/XLPE/PVC", 123, ["ground", "duct", "air"]),
    ("mv3_cu_xlpe_87","mv3", "cu", "xlpe", "8.7/15 (17.5) kV 3-Core Cu/XLPE/PVC", 124, ["ground", "duct", "air"]),
    ("mv3_al_xlpe_87","mv3", "al", "xlpe", "8.7/15 (17.5) kV 3-Core AL/XLPE/PVC", 124, ["ground", "duct", "air"]),
    ("mv1_cu_xlpe_87","mv1", "cu", "xlpe", "8.7/15 (17.5) kV Single Core Cu/XLPE/PVC (shielded)", 124, ["groundFlat", "groundTrefoil", "duct", "airFlatTouched", "airTrefoilTouched"]),
    ("mv1_al_xlpe_87","mv1", "al", "xlpe", "8.7/15 (17.5) kV Single Core AL/XLPE/PVC (shielded)", 124, ["groundFlat", "groundTrefoil", "duct", "airFlatTouched", "airTrefoilTouched"]),
]

def voltage_of(key):
    if key.endswith("_87"):
        return "8.7/15 (17.5) kV"
    if key.endswith("_610"):
        return "6/10 (12) kV"
    if key.endswith("_36"):
        return "3.6/6 (7.2) kV"
    return "0.6/1 kV"

def fmt_num(k, v):
    if isinstance(v, str):
        return v
    if k in ("dc20", "ac", "capUfKm", "indMhKm"):
        return repr(round(float(v), 6))
    if float(v).is_integer():
        return repr(int(v))
    return repr(round(float(v), 4))

def emit_table(key, cores, conductor, insulation, label, page, cols):
    data = amp[key]
    rows = []
    for r in data["rows"]:
        fields = {"csa": r["csa"], "csaLabel": r["csaLabel"], "dc20": r["dc20"], "ac": r["ac"]}
        if key.startswith("mv"):
            fields["capUfKm"] = r["capUfKm"]
            fields["indMhKm"] = r["indMhKm"]
        for ci, col in enumerate(cols):
            fields[col] = r["amps"][ci]
        rows.append(fields)
    row_ts = ",\n".join(
        "    { " + ", ".join(f"{k}: {fmt_num(k, v)}" for k, v in row.items()) + " }"
        for row in rows
    )
    notes = ""
    if key == "sc_cu_pvc":
        notes = '\n  notes: ["قيمة airFlatTouched لمقطع 10مم² مطبوعة 9A بالكتالوج (خطأ طباعي واضح: 6مم²=48 و16مم²=85) — لا تُعتمد"],'
    return f'''  {{
    id: "{key}",
    label: "{label}",
    voltage: "{voltage_of(key)}",
    cores: "{cores}",
    conductor: "{conductor}",
    insulation: "{insulation}",
    page: {page},
    cols: ["{ '", "'.join(cols) if False else '", "'.join(cols) }"],
    rows: [
{row_ts},
    ],{notes}
  }}'''

tables_ts = ",\n".join(emit_table(*t) for t in AMPACITY_DEFS)

# ─────────────────────────── emit TS file ───────────────────────────

ts = f'''/**
 * ELSEWEDY POWER CABLES KNOWLEDGE BASE — AUTO-GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Source: "Power Cables.pdf" — Elsewedy Electric Cables catalogue (Power Cables
 * Division). Every numeric entry was extracted programmatically from the PDF
 * text layer by scripts/extract_cables_kb.py + scripts/gen_cables_kb_ts.py and
 * verified against the printed pages (coordinate-level spot checks included).
 *
 * Suspect cells (catalogue misprints kept verbatim + flagged):
 *  - sc_cu_pvc 10mm² airFlatTouched printed "9" (neighbours: 48 @ 6mm², 85 @ 16mm²).
 *  - Table 11 perforatedTrefoil t2/3cables printed "0.98" (breaks monotonic trend).
 * The sizing engine treats flagged cells conservatively (uses the lower sane
 * bound) and the citation layer surfaces the caveat whenever the cell matters.
 *
 * Citation format: [Elsewedy Electric — Power Cables Catalogue, Table/Section X, p.N]
 * Catalogue ampacity basis (General Information §7, p.15): IEC 60287 — air 30°C
 * shaded, ground 20°C, soil thermal resistivity 100 K.cm/W, depth 0.5 m, duct
 * diameter 1.5×cable OD, unity load factor, 50 Hz.
 */

export interface CableAmpacityRow {{
  csa: number;
  csaLabel: string;
  dc20: number;
  ac: number;
  capUfKm?: number;
  indMhKm?: number;
  groundFlat?: number;
  groundTrefoil?: number;
  duct?: number;
  airFlatSeparated?: number;
  airFlatTouched?: number;
  airTrefoilTouched?: number;
  ground?: number;
  air?: number;
}}

export interface CableAmpacityTable {{
  id: string;
  label: string;
  voltage: string;
  cores: "single" | "multi3" | "multi4" | "multi4red" | "mv3" | "mv1";
  conductor: "cu" | "al";
  insulation: "pvc" | "xlpe";
  page: number;
  cols: string[];
  rows: CableAmpacityRow[];
  notes?: string[];
}}

export const ELSEWEDY_META = {{
  source: "Elsewedy Electric — Power Cables Catalogue (Power Cables Division)",
  citationFormat: "[Elsewedy Electric — Power Cables Catalogue, <Table/Section>, p.N]",
  ampacityBasis: "IEC 60287 — هواء 30°C مظلل، أرض 20°C، مقاومة حرارية للتربة 100 K.cm/W، عمق 0.5م، قطر مجرى 1.5×قطر الكابل، معامل حمل = 1، تردد 50Hz",
  tableCount: {len(AMPACITY_DEFS)},
}} as const;

/** Ampacity tables — the sizing engine searches these in ascending csa order. */
export const AMPACITY_TABLES: CableAmpacityTable[] = [
{tables_ts},
];

// ─── Short-circuit withstand (kA), Tables 14-17, pp.20-22 ────────────────────

export const SC_DURATIONS = {json.dumps(SC_DURATIONS)} as const;

export const SHORT_CIRCUIT_TABLES: Record<string, Record<number, number[]>> = {{
'''
for key, vals in SC.items():
    entries = ",\n".join(f"    {csa}: {arr(v)}" for csa, v in sorted(vals.items()))
    ts += f'  {key}: {{\n{entries},\n  }},\n'
ts += f'''}};
'''
ts += '''
// ─── Voltage drop (mV/A/m), Tables 18-19, pp.23-24 ───────────────────────────
// Basis: max operating temp 90°C XLPE / 70°C PVC, pf 0.8, 50 Hz, cables touched
// in flat formation. Single-core table = three-phase circuit (3 single cores).
// Structure: VOLTAGE_DROP_SINGLE_CORE[cu|al][csa] = {flat, trefoil, xlpeFlat, xlpeTrefoil}
//            VOLTAGE_DROP_MULTICORE[cu|al][csa] = {pvc, xlpe}
'''
ts += "export const VOLTAGE_DROP_SINGLE_CORE = {\n  cu: {\n"
ts += "      4: { flat: 7.83, trefoil: 7.77, xlpeFlat: 8.337, xlpeTrefoil: 8.277 },\n"
ts += "      6: { flat: 5.287, trefoil: 5.226, xlpeFlat: 5.628, xlpeTrefoil: 5.568 },\n"
ts += "      10: { flat: 3.184, trefoil: 3.124, xlpeFlat: 3.401, xlpeTrefoil: 3.341 },\n"
ts += "      16: { flat: 2.068, trefoil: 2.008, xlpeFlat: 2.203, xlpeTrefoil: 2.142 },\n"
ts += "      25: { flat: 1.357, trefoil: 1.297, xlpeFlat: 1.44, xlpeTrefoil: 1.38 },\n"
ts += "      35: { flat: 1.034, trefoil: 0.971, xlpeFlat: 1.085, xlpeTrefoil: 1.024 },\n"
ts += "      50: { flat: 0.793, trefoil: 0.732, xlpeFlat: 0.836, xlpeTrefoil: 0.776 },\n"
ts += "      70: { flat: 0.595, trefoil: 0.534, xlpeFlat: 0.624, xlpeTrefoil: 0.564 },\n"
ts += "      95: { flat: 0.469, trefoil: 0.408, xlpeFlat: 0.49, xlpeTrefoil: 0.43 },\n"
ts += "      120: { flat: 0.41, trefoil: 0.349, xlpeFlat: 0.417, xlpeTrefoil: 0.357 },\n"
ts += "      150: { flat: 0.354, trefoil: 0.294, xlpeFlat: 0.366, xlpeTrefoil: 0.305 },\n"
ts += "      185: { flat: 0.312, trefoil: 0.252, xlpeFlat: 0.322, xlpeTrefoil: 0.262 },\n"
ts += "      240: { flat: 0.272, trefoil: 0.211, xlpeFlat: 0.278, xlpeTrefoil: 0.218 },\n"
ts += "      300: { flat: 0.247, trefoil: 0.187, xlpeFlat: 0.253, xlpeTrefoil: 0.192 },\n"
ts += "      400: { flat: 0.224, trefoil: 0.164, xlpeFlat: 0.22, xlpeTrefoil: 0.159 },\n"
ts += "      500: { flat: 0.208, trefoil: 0.148, xlpeFlat: 0.211, xlpeTrefoil: 0.15 },\n"
ts += "      630: { flat: 0.194, trefoil: 0.134, xlpeFlat: 0.191, xlpeTrefoil: 0.131 },\n"
ts += "  },\n  al: {\n"
ts += "      16: { flat: 3.343, trefoil: 3.283, xlpeFlat: 3.561, xlpeTrefoil: 3.5 },\n"
ts += "      25: { flat: 2.161, trefoil: 2.1, xlpeFlat: 2.296, xlpeTrefoil: 2.235 },\n"
ts += "      35: { flat: 1.602, trefoil: 1.542, xlpeFlat: 1.7, xlpeTrefoil: 1.64 },\n"
ts += "      50: { flat: 1.222, trefoil: 1.162, xlpeFlat: 1.291, xlpeTrefoil: 1.23 },\n"
ts += "      70: { flat: 0.89, trefoil: 0.83, xlpeFlat: 0.937, xlpeTrefoil: 0.877 },\n"
ts += "      95: { flat: 0.686, trefoil: 0.623, xlpeFlat: 0.719, xlpeTrefoil: 0.655 },\n"
ts += "      120: { flat: 0.569, trefoil: 0.509, xlpeFlat: 0.594, xlpeTrefoil: 0.534 },\n"
ts += "      150: { flat: 0.49, trefoil: 0.43, xlpeFlat: 0.511, xlpeTrefoil: 0.451 },\n"
ts += "      185: { flat: 0.42, trefoil: 0.36, xlpeFlat: 0.437, xlpeTrefoil: 0.377 },\n"
ts += "      240: { flat: 0.353, trefoil: 0.293, xlpeFlat: 0.367, xlpeTrefoil: 0.307 },\n"
ts += "      300: { flat: 0.312, trefoil: 0.252, xlpeFlat: 0.322, xlpeTrefoil: 0.262 },\n"
ts += "      400: { flat: 0.274, trefoil: 0.214, xlpeFlat: 0.278, xlpeTrefoil: 0.218 },\n"
ts += "      500: { flat: 0.245, trefoil: 0.185, xlpeFlat: 0.26, xlpeTrefoil: 0.199 },\n"
ts += "      630: { flat: 0.222, trefoil: 0.162, xlpeFlat: 0.223, xlpeTrefoil: 0.163 },\n"
ts += "  },\n};\n\nexport const VOLTAGE_DROP_MULTICORE = {\n  cu: {\n"
ts += "      1.5: { pvc: 20.345, xlpe: 20.341 },\n"
ts += "      2.5: { pvc: 12.397, xlpe: 13.197 },\n"
ts += "      4: { pvc: 7.741, xlpe: 7.731 },\n"
ts += "      6: { pvc: 5.199, xlpe: 5.191 },\n"
ts += "      10: { pvc: 3.101, xlpe: 3.094 },\n"
ts += "      16: { pvc: 1.275, xlpe: 1.282 },\n"
ts += "      25: { pvc: 0.957, xlpe: 1.009 },\n"
ts += "      35: { pvc: 0.726, xlpe: 0.764 },\n"
ts += "      50: { pvc: 0.526, xlpe: 0.552 },\n"
ts += "      70: { pvc: 0.402, xlpe: 0.418 },\n"
ts += "      95: { pvc: 0.334, xlpe: 0.347 },\n"
ts += "      120: { pvc: 0.287, xlpe: 0.297 },\n"
ts += "      150: { pvc: 0.246, xlpe: 0.254 },\n"
ts += "      185: { pvc: 0.207, xlpe: 0.212 },\n"
ts += "      240: { pvc: 0.182, xlpe: 0.185 },\n"
ts += "      300: { pvc: 0.16, xlpe: 0.163 },\n"
ts += "      400: { pvc: 0.144, xlpe: 0.145 },\n"
ts += "  },\n  al: {\n"
ts += "      16: { pvc: 3.263, xlpe: 3.479 },\n"
ts += "      25: { pvc: 2.084, xlpe: 2.218 },\n"
ts += "      35: { pvc: 1.527, xlpe: 1.624 },\n"
ts += "      50: { pvc: 1.15, xlpe: 1.217 },\n"
ts += "      70: { pvc: 0.819, xlpe: 0.865 },\n"
ts += "      95: { pvc: 0.613, xlpe: 0.645 },\n"
ts += "      120: { pvc: 0.5, xlpe: 0.524 },\n"
ts += "      150: { pvc: 0.421, xlpe: 0.442 },\n"
ts += "      185: { pvc: 0.352, xlpe: 0.369 },\n"
ts += "      240: { pvc: 0.286, xlpe: 0.299 },\n"
ts += "      300: { pvc: 0.245, xlpe: 0.255 },\n"
ts += "      400: { pvc: 0.208, xlpe: 0.211 },\n"
ts += "  },\n};\n"
ts += '''
/** Table 3 — air temperature (basis 30°C shaded). */
export const T3_AIR_TEMPS = ''' + json.dumps(AIR_TEMPS) + ''';
export const T3_AIR = {
  pvc70: ''' + arr(T3_AIR["pvc70"]) + ''',
  xlpe90: ''' + arr(T3_AIR["xlpe90"]) + ''',
};

/** Table 4 — ground temperature (basis 20°C). */
export const T4_GROUND = {
  pvc70: ''' + arr(T4_GROUND["pvc70"]) + ''',
  xlpe90: ''' + arr(T4_GROUND["xlpe90"]) + ''',
};

/** Table 5 — burial depth (basis 0.5 m), key: {direct|duct}_{sc_le185|sc_gt185|3c}. */
export const T5_DEPTHS = ''' + json.dumps(T5_DEPTHS) + ''';
export const T5_DEPTH = ''' + obj(T5_DEPTH) + ''';

/** Table 6 — soil thermal resistivity (K.°C/W, basis 100 K.cm/W ≈ 1.0). */
export const T6_SOIL_K = ''' + json.dumps(T6_SOIL_K) + ''';
export const T6_SOIL_F = ''' + arr(T6_SOIL_F) + ''';

/** Table 7 — PVC rated-temperature upgrade factors. */
export const T7_PVC_RATED = ''' + json.dumps(T7_PVC_RATED) + ''';
export const T7_PVC = ''' + obj(T7_PVC) + ''';

/** Table 8 — grouping of 3 single-core circuits laid direct in ground (nr=2..6). */
export const T8_CIRCUITS = ''' + json.dumps(T8_CIRCUITS) + ''';
export const T8_SINGLE_GROUND = ''' + obj(T8_SINGLE_GROUND) + ''';

/** Table 9 — grouping of multi-core circuits laid direct in ground (nr=2..6). */
export const T9_MULTICORE_GROUND = ''' + obj(T9_MULTICORE_GROUND) + ''';

/** Table 10 — grouping of multi-core cables in air (trays t1..t3, cables 1..9). */
export const T10_CABLES = ''' + json.dumps(T10_CABLES) + ''';
export const T10_MULTICORE_AIR = ''' + obj_t10(T10_MULTICORE_AIR) + ''';

/** Table 11 — grouping of single-core circuits in air (cables 1..3 per tray set). */
export const T11_SINGLE_AIR = ''' + obj_t10(T11_SINGLE_AIR) + ''';
export const T11_SUSPECT_CELLS = ''' + json.dumps([list(x) for x in T11_SUSPECT]) + ''';

/** Table 12 — minimum separation in air (multiples of cable OD) to cancel grouping. */
export const T12_MIN_SEPARATION = {
  sideBySide: { twoMultiCore: 0.5, threeMultiCore: 0.75, twoTrefoils: 1, threeTrefoils: 1.5 },
  oneAboveOther: { twoMultiCore: 2, threeMultiCore: 4, twoTrefoils: 4 },
  nearVerticalOrBelowHorizontalSurface: 0.5,
} as const;

/** Table 13 — max short-circuit temperatures of cable components (°C). */
export const T13_SC_TEMPS = {
  pvcInsulation: { csaGt300: 140, csaLe300: 160 },
  xlpeInsulation: 250,
  pvcSheath: 200, lldpeSheath: 150, hdpeSheath: 180,
  leadSheath: 170, leadAlloySheath: 200,
  copper: 250, aluminum: 250,
} as const;

// ─── Conversions & metal properties ──────────────────────────────────────────

/** Table 21 — AWG/MCM → mm². */
export const AWG_TO_MM2: Array<[string, number]> = ''' + json.dumps([[str(a), b] for a, b in AWG + AWG_MCM]) + ''';

/** Table 22 — equivalent Cu → Al cross-sections (same current capacity). */
export const CU_TO_AL: Array<[number, number]> = ''' + json.dumps(CU_AL) + ''';

/** Tables 1-2 — metal electrical/physical properties (basis of the formulas below). */
export const METAL_PROPERTIES = {
  cu: { iacs: 100, resistivityOhmM8: 1.7241, tempCoeff: 0.00393, density: 8890, meltingPointC: 1083 },
  al: { iacs: 61, resistivityOhmM8: 2.8264, tempCoeff: 0.00403, density: 2703, meltingPointC: 659 },
} as const;

// ─── The catalogue's own formulas (General Information §D, pp.14-15) ─────────

export const CATALOGUE_FORMULAS = {
  resistanceTempCorrection: "R(θ) = R20 × [1 + α(θ − 20)] Ω/Km — αCu=0.00393, αAl=0.00403 per °C (R20 من الجدول)",
  voltageDropSinglePhase: "Vd = 2 × I × l × (R cosφ + X sinφ) V — دائرة أحادية الطور (§9-A)",
  voltageDropThreePhase: "Vd = √3 × I × l × (R cosφ + X sinφ) V — دائرة ثلاثية الطور (§9-B)",
  scBeyondTable: "I_s.c.t = I_s.c.1 / √t kA — لأي زمن غير مذكور بالجدول (§8)",
  inductance: "L = K + 0.2 ln(2S/d) mH/Km — K ثابت، d قطر الموصل، S التباعد المحوري (تُضرب المسافة ×1.26 للتكوين المسطح)",
  capacitance: "C = εr / (18 ln(D/d)) µF/Km — D قطر فوق العازل، d تحته",
  chargingCurrent: "Ic = U0 × m × C × 10^-6 A/Km — m = 2πf",
  dielectricLosses: "Wd = ωC U0² tanδ × 10^-6 W/Km/phase",
  insulationResistance: "R = K ln(D/d) MΩ/Km",
  cosPhiSinPhi: [[1.0, 0.0], [0.9, 0.44], [0.8, 0.6], [0.71, 0.71], [0.6, 0.8], [0.5, 0.87]],
} as const;

/** Catalogue design guidance (General Information, pp.5, 15). */
export const CATALOGUE_GUIDANCE = {
  selectionFactors: [
    "تعيين الجهد (U0/U(Um))",
    "معامل الحمل",
    "الحمل المطلوب (أمبير أو MVA)",
    "مستوى تيار القصر (kA) ومدته (ث)",
    "الظروف البيئية",
    "ظروف التمديد (الهواء/الأرض/المجارى)",
  ],
  voltageDropLimit: "تُصمم شبكات الجهد المنخفض بحيث لا يتجاوز هبوط الجهد 3-5% في التشغيل العادي (§9، ص15)",
  frequency: "جميع قيم الكتالوج على أساس 50Hz (§10)",
  loadFactor: "قيم التيار محسوبة على أساس معامل حمل = 1 (§11)",
  standards: [
    "IEC 60228 — موصلات الكابلات المعزولة",
    "IEC 60502-1 — كابلات حتى 1kV (Um=1.2kV)",
    "IEC 60502-2 — كابلات 6-30kV (Um=7.2-36kV)",
    "IEC 60287 — حساب قدرة تحميل التيار",
    "IEC 60949 — تيارات القصر الحرارية (غير أدياباتي)",
    "IEC 60332 — انتشار اللهب، IEC 60331 — سلامة الدائرة تحت الحريق",
    "BS 5467 / BS 6724 / BS 7870 — كابلات مسلحة thermosetting",
    "IEC 60724 / 60986 — حدود حرارة القصر للكابلات LV/MV",
  ],
} as const;

/** SAMPLER — deterministic pick used by tests to prove KB integrity. */
export const KB_INTEGRITY_SAMPLER = {
  scCuXlpe800_1s: 114.5,
  vdMc4Cu25Pvc: 0.957,
  ampMc4CuXlpe25Ground: 155,
  ampMc4CuXlpe25Air: 131,
  ampScCuPvc50GroundFlat: 203,
  deratingT3Air40Xlpe: 0.9,
} as const;
'''

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8").write(ts)
print("wrote", OUT, len(ts), "chars")
print("ampacity tables:", len(AMPACITY_DEFS), "| SC keys:", list(SC.keys()))
print("VD18 cu rows:", len(vd18_cu), "| VD19 al rows:", len(vd19_al))
