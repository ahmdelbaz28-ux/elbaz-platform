#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GENERATOR for the references knowledge-base TypeScript files (round 2).

Consumes (produced by scripts/extract_refs_kb.py):
  /home/z/my-project/scripts/kb/saudi_dps.json
  /home/z/my-project/scripts/kb/abb_tr.json
  /home/z/my-project/scripts/kb/schneider_brk.json
  /home/z/my-project/scripts/kb/refs_pages.json

Emits:
  api/lib/chatbot-saudi-kb.ts      (SEC DPS-01 tables/rules — cell-verified)
  api/lib/chatbot-abb-kb.ts        (ABB distribution-transformers catalogue)
  api/lib/chatbot-schneider-kb.ts  (Schneider Egypt Breakers & Switches price list 2026)
  api/lib/chatbot-refs-pages-kb.ts (FULL page-level index of all 7 documents)

Re-run: python3 scripts/gen_refs_kb_ts.py
"""
import json, os

KB = "/home/z/my-project/scripts/kb"
OUT = "/home/z/my-project/elbaz-platform/api/lib"

def j(obj):
    return json.dumps(obj, ensure_ascii=False)

def ts_str(s):
    """JSON string literal — safe inside TS (double quotes escaped)."""
    return json.dumps(s, ensure_ascii=False)

# ════════════════════════════════════════════════════════════════════════════
# 1) chatbot-saudi-kb.ts
# ════════════════════════════════════════════════════════════════════════════

dps = json.load(open(f"{KB}/saudi_dps.json", encoding="utf-8"))
cf_arr = [None] + [dps["coincidenceFactors"]["cf"][str(i)] for i in range(1, 100)]

def area_row(r):
    return '{"amp": ' + ("null" if r["amp"] is None else str(int(r["amp"]))) + ', "kva": ' + j(r["kva"]) + ', "area": ' + j(r["area"]) + "}"

def density_row(r):
    return '{ "code": ' + ts_str(r["code"]) + ', "category": ' + ts_str(r["category"]) + ', "loads": ' + ts_str(r["loads"]) + ', "va": ' + str(r["va"]) + " }"

def df_row(r):
    return '{ "code": ' + ts_str(r["code"]) + ', "category": ' + ts_str(r["category"]) + ', "df": ' + j(r["df"]) + " }"

def type_row(t):
    return ('{ "code": ' + ts_str(t["code"]) + ', "name": ' + ts_str(t["name"]) + ', "desc": ' + ts_str(t["desc"])
            + ', "includes": ' + ts_str(t["includes"]) + ', "page": ' + str(t["page"]) + " }")

def rule_row(r):
    return ('{ "id": ' + ts_str(r["id"]) + ', "page": ' + str(r["page"]) + ', "title": ' + ts_str(r["title"]) + ', "text": ' + ts_str(r["text"]) + " }")

def section_row(s):
    return '{ "section": ' + ts_str(s["section"]) + ', "title": ' + ts_str(s["title"]) + ', "page": ' + str(s["page"]) + " }"

def area_table(t):
    return ('{ "id": ' + ts_str(t["id"]) + ', "label": ' + ts_str(t["label"]) + ', "page": ' + str(t["page"]) + ', "rows": [\n    '
            + ",\n    ".join(area_row(r) for r in t["rows"]) + "\n] }")

def density_table(t):
    return ('{ "id": ' + ts_str(t["id"]) + ', "label": ' + ts_str(t["label"]) + ', "page": ' + str(t["page"]) + ', "rows": [\n    '
            + ",\n    ".join(density_row(r) for r in t["rows"]) + "\n] }")

t3 = next(t for t in dps["areaTables"] if t["id"] == "t3")
t4 = next(t for t in dps["areaTables"] if t["id"] == "t4")
t5 = next(t for t in dps["areaTables"] if t["id"] == "t5")
t6 = next(t for t in dps["areaTables"] if t["id"] == "t6")
t8 = next(t for t in dps["densityTables"] if t["id"] == "t8")
t9 = next(t for t in dps["densityTables"] if t["id"] == "t9")
t10 = next(t for t in dps["densityTables"] if t["id"] == "t10")

saudi_ts = """/**
 * SAUDI DPS-01 KNOWLEDGE BASE — Saudi Electricity Company Distribution
 * Planning Standard DPS-01: Estimation of Customer Load Guideline
 * (Connected Load & Demand Load), Rev.02, September 2015 — 46 pages.
 *
 * GENERATED FILE (scripts/gen_refs_kb_ts.py) — do not hand-edit.
 * Source: "DPSالكود السعودي .pdf". Every table row was parsed from word
 * coordinates and verified against sampled printed values (anchors):
 * T3 area 25→4kVA/CB30 … 2701→367kVA/CB1000; T4 25→4/CB20 … 4800→648;
 * T5 25→6/CB30 … 1701→364/CB1000; T6 25→6/CB30 … 2201→470/CB800;
 * CF(1)=1.000, CF(2)=0.723, CF(99)=0.563; DF C1=0.60 … C29=0.90.
 *
 * Citation format: [SEC DPS-01 — Estimation of Customer Load Guideline، <Table/Section>، ص.<P>]
 */

export interface SaudiAreaRow { amp: number | null; kva: number; area: number }
export interface SaudiAreaTable { id: string; label: string; page: number; rows: SaudiAreaRow[] }
export interface SaudiDensityRow { code: string; category: string; loads: string; va: number }
export interface SaudiDensityTable { id: string; label: string; page: number; rows: SaudiDensityRow[] }
export interface SaudiDfRow { code: string; category: string; df: number }
export interface SaudiType { code: string; name: string; desc: string; includes: string; page: number }
export interface SaudiRule { id: string; page: number; title: string; text: string }
export interface SaudiSection { section: string; title: string; page: number }

export const SAUDI_META = {
  doc: "Saudi Electricity Company — Distribution Planning Standard DPS-01: Estimation of Customer Load Guideline (Connected Load & Demand Load), Rev.02, September 2015",
  citationFormat: "[SEC DPS-01 — Estimation of Customer Load Guideline، <Table/Section>، ص.<P>]",
  citationFormatEn: "[SEC DPS-01 — Estimation of Customer Load Guideline, <Table/Section>, p.<P>]",
  pages: 46,
} as const;

export const SAUDI_AREA_TABLES: SaudiAreaTable[] = [
  """ + ",\n  ".join(area_table(t) for t in dps["areaTables"]) + """
];

export const SAUDI_DENSITY_TABLES: SaudiDensityTable[] = [
  """ + ",\n  ".join(density_table(t) for t in dps["densityTables"]) + """
];

export const SAUDI_DEMAND_FACTORS: SaudiDfRow[] = [
  """ + ",\n  ".join(df_row(r) for r in dps["demandFactors"]["rows"]) + """
];

/** CF(N) for N = 1..99 — index 0 unused (Table 12, ص.33). */
export const SAUDI_COINCIDENCE: Array<number | null> = """ + j(cf_arr).replace("None", "null") + """;

export const SAUDI_TYPES: SaudiType[] = [
  """ + ",\n  ".join(type_row(t) for t in dps["types"]) + """
];

export const SAUDI_RULES: SaudiRule[] = [
  """ + ",\n  ".join(rule_row(r) for r in dps["rules"]) + """
];

/** Printed §-index (section number → title, first page). */
export const SAUDI_SECTIONS: SaudiSection[] = [
  """ + ",\n  ".join(section_row(s) for s in dps["sections"]) + """
];

/** Anchor values verified cell-by-cell against the printed standard — the
 *  test-suite and runtime integrity probe assert these. */
export const SAUDI_INTEGRITY_SAMPLER = {
  t3_area25: { kva: """ + j(next(r["kva"] for r in t3["rows"] if r["area"] == 25)) + """, cb: """ + str(int(next(r["amp"] for r in t3["rows"] if r["area"] == 25))) + """ },
  t3_area2701: { kva: """ + j(next(r["kva"] for r in t3["rows"] if r["area"] == 2701)) + """, cb: """ + str(int(next(r["amp"] for r in t3["rows"] if r["area"] == 2701))) + """ },
  t4_area4800: { kva: """ + j(next(r["kva"] for r in t4["rows"] if r["area"] == 4800)) + """ },
  t5_area1701: { kva: """ + j(next(r["kva"] for r in t5["rows"] if r["area"] == 1701)) + """, cb: """ + str(int(next(r["amp"] for r in t5["rows"] if r["area"] == 1701))) + """ },
  t6_area2201: { kva: """ + j(next(r["kva"] for r in t6["rows"] if r["area"] == 2201)) + """, cb: """ + str(int(next(r["amp"] for r in t6["rows"] if r["area"] == 2201))) + """ },
  density_t8_c29: """ + str(next(r["va"] for r in t8["rows"] if r["code"] == "C29")) + """,
  density_t9_c6: """ + str(next(r["va"] for r in t9["rows"] if r["code"] == "C6")) + """,
  density_t10_c21: """ + str(next(r["va"] for r in t10["rows"] if r["code"] == "C21")) + """,
  df_c1: 0.6,
  df_c29: 0.9,
  cf_2: 0.723,
  cf_99: 0.563,
  typesCount: """ + str(len(dps["types"])) + """,
  rulesCount: """ + str(len(dps["rules"])) + """,
} as const;
"""

open(f"{OUT}/chatbot-saudi-kb.ts", "w", encoding="utf-8").write(saudi_ts)
print("→ chatbot-saudi-kb.ts", len(saudi_ts), "chars")

# ════════════════════════════════════════════════════════════════════════════
# 2) chatbot-abb-kb.ts
# ════════════════════════════════════════════════════════════════════════════

abb = json.load(open(f"{KB}/abb_tr.json", encoding="utf-8"))

def abb_item(it):
    keys = ["kva", "hv1", "hv2", "lv1", "vector", "zk", "nllW", "llW", "noiseDb",
            "totalKg", "oilKg", "lenMm", "widMm", "heiMm", "wheelMm", "tank", "page", "section"]
    parts = []
    for k in keys:
        v = it.get(k)
        if k == "vector":
            parts.append('"vector": ' + ts_str(v))
        elif k == "wheelMm":
            parts.append('"wheelMm": ' + ("null" if v is None else j(v)))
        else:
            parts.append(f'"{k}": ' + j(v))
    return "{ " + ", ".join(parts) + " }"

def abb_large(it):
    return ('{ "kva": ' + j(it["kva"]) + ', "tap": ' + ts_str(it["tap"]) + ', "nllW": ' + j(it["nllW"])
            + ', "llW": ' + j(it["llW"]) + ', "zk": ' + j(it["zk"]) + ', "totalKg": ' + j(it["totalKg"])
            + ', "oilKg": ' + j(it["oilKg"]) + ', "page": ' + str(it["page"]) + ', "section": ' + ts_str(it["section"]) + " }")

def abb_loss(it):
    return ('{ "kva": ' + j(it["kva"]) + ', "ll120W": ' + j(it["ll120W"]) + ', "ll75W": ' + j(it["ll75W"])
            + ', "nllW": ' + j(it["nllW"]) + ', "zk": ' + j(it["zk"]) + ', "soundDb": ' + j(it["soundDb"])
            + ', "page": ' + str(it["page"]) + ', "section": ' + ts_str(it["section"]) + ', "table": ' + ts_str(it["table"]) + " }")

def abb_dim(it):
    fields = ["kva", "aMm", "bMm", "hMm", "b1Mm", "b2Mm", "eMm", "diaMm", "gMm", "weightKg"]
    parts = [f'"{k}": ' + j(it[k]) for k in fields]
    parts.append('"page": ' + str(it["page"]))
    parts.append('"section": ' + ts_str(it["section"]))
    parts.append('"table": ' + ts_str(it["table"]))
    return "{ " + ", ".join(parts) + " }"

def abb_desc(d):
    return '{ "id": ' + ts_str(d["id"]) + ', "page": ' + str(d["page"]) + ', "title": ' + ts_str(d["title"]) + ', "text": ' + ts_str(d["text"]) + " }"

med_315 = next(x for x in abb["items"] if x["section"] == "medium" and x["kva"] == 315 and x["hv1"] == 26000)
loss30 = next(x for x in abb["lossItems"] if x["page"] == 30 and x["kva"] == 50)
res38 = next(x for x in abb["lossItems"] if x["page"] == 38 and x["kva"] == 100)
dim34 = next(x for x in abb["ip00Dims"] if x["page"] == 34 and x["kva"] == 50)
small30 = next(x for x in abb["items"] if x["section"] == "small" and x["kva"] == 30)
vec_json = json.dumps(small30["vector"], ensure_ascii=False)

abb_ts = """/**
 * ABB DISTRIBUTION TRANSFORMERS KNOWLEDGE BASE
 *
 * GENERATED FILE (scripts/gen_refs_kb_ts.py) — do not hand-edit.
 * Source: "ABB Transformers.pdf" (51 pages). Tables parsed from word
 * coordinates: small (≤250kVA, 61 designs), medium (>250-2000kVA, 36),
 * large typical datas (6), dry Vacuum-Cast-Coil + RESIBLOC losses (112),
 * VCC IP00 dimensions (40). The catalogue prints the tank glyph as L=▲
 * hermetically-sealed and G=● conservator — decoded in "tank".
 * Suspected print errors are KEPT and flagged (abbFlags).
 *
 * Citation format: [ABB — Distribution Transformers Catalogue، <Section>، ص.<P>]
 */

export interface AbbItem {
  kva: number; hv1: number; hv2: number; lv1: number; vector: string;
  zk: number; nllW: number; llW: number; noiseDb: number;
  totalKg: number; oilKg: number; lenMm: number; widMm: number; heiMm: number;
  wheelMm: number | null; tank: string; page: number; section: string;
}
export interface AbbLargeItem { kva: number; tap: string; nllW: number; llW: number; zk: number; totalKg: number; oilKg: number; page: number; section: string }
export interface AbbLossItem { kva: number; ll120W: number; ll75W: number; nllW: number; zk: number; soundDb: number; page: number; section: string; table: string }
export interface AbbDimItem { kva: number; aMm: number; bMm: number; hMm: number; b1Mm: number; b2Mm: number; eMm: number; diaMm: number; gMm: number; weightKg: number; page: number; section: string; table: string }
export interface AbbDesc { id: string; page: number; title: string; text: string }

export const ABB_META = {
  doc: "ABB — Distribution Transformers catalogue (The most comprehensive range of solutions for distribution transformer applications)",
  citationFormat: "[ABB — Distribution Transformers Catalogue، <Section>، ص.<P>]",
  citationFormatEn: "[ABB — Distribution Transformers Catalogue, <Section>, p.<P>]",
  pages: 51,
  tankGlyphs: { L: "▲ مختومة بإحكام بخزان مموج (Hermetically sealed)", G: "● بخزان مموج مع موسّع زيت (Conservator)" },
} as const;

export const ABB_ITEMS: AbbItem[] = [
  """ + ",\n  ".join(abb_item(x) for x in abb["items"]) + """
];

export const ABB_LARGE_ITEMS: AbbLargeItem[] = [
  """ + ",\n  ".join(abb_large(x) for x in abb["largeItems"]) + """
];

export const ABB_LOSS_ITEMS: AbbLossItem[] = [
  """ + ",\n  ".join(abb_loss(x) for x in abb["lossItems"]) + """
];

export const ABB_IP00_DIMS: AbbDimItem[] = [
  """ + ",\n  ".join(abb_dim(x) for x in abb["ip00Dims"]) + """
];

export const ABB_DESCRIPTIVE: AbbDesc[] = [
  """ + ",\n  ".join(abb_desc(x) for x in abb["descriptive"]) + """
];

/** Catalogue cells whose printed value is out of engineering range — kept
 *  verbatim (never silently "fixed") and flagged for the reader. */
export const ABB_FLAGS: Array<{ page: number; kva: number; hv1: number; msg: string }> = """ + j(abb["flags"]).replace("None", "null") + """;

export const ABB_INTEGRITY_SAMPLER = {
  small30: { vector: """ + vec_json + """, hv1: """ + j(small30["hv1"]) + """, lv1: """ + j(small30["lv1"]) + """ },
  med315_26000: { nllW: """ + j(med_315["nllW"]) + """, llW: """ + j(med_315["llW"]) + """, zk: """ + j(med_315["zk"]) + """, totalKg: """ + j(med_315["totalKg"]) + """ },
  vcc12_50: { ll120W: """ + j(loss30["ll120W"]) + """, nllW: """ + j(loss30["nllW"]) + """, zk: """ + j(loss30["zk"]) + """, soundDb: """ + j(loss30["soundDb"]) + """ },
  resibloc12_100: { ll120W: """ + j(res38["ll120W"]) + """, nllW: """ + j(res38["nllW"]) + """, soundDb: """ + j(res38["soundDb"]) + """ },
  ip00_12_50: { aMm: """ + j(dim34["aMm"]) + """, weightKg: """ + j(dim34["weightKg"]) + """ },
  itemsCount: """ + str(len(abb["items"])) + """,
  lossItemsCount: """ + str(len(abb["lossItems"])) + """,
  ip00DimsCount: """ + str(len(abb["ip00Dims"])) + """,
  largeItemsCount: """ + str(len(abb["largeItems"])) + """,
} as const;
"""

open(f"{OUT}/chatbot-abb-kb.ts", "w", encoding="utf-8").write(abb_ts)
print("→ chatbot-abb-kb.ts", len(abb_ts), "chars")

# ════════════════════════════════════════════════════════════════════════════
# 3) chatbot-schneider-kb.ts
# ════════════════════════════════════════════════════════════════════════════

brk = json.load(open(f"{KB}/schneider_brk.json", encoding="utf-8"))

def brk_item(x):
    parts = [
        '"ref": ' + ts_str(x["ref"]),
        '"price": ' + j(x["price"]),
        '"auxA": ' + ("null" if x.get("auxA") is None else j(x["auxA"])),
        '"page": ' + str(x["page"]),
        '"part": ' + ts_str(x["part"]),
        '"subsection": ' + ts_str(x.get("subsection") or ""),
        '"desc": ' + ts_str(x.get("desc") or ""),
        '"ratingA": ' + ("null" if x.get("ratingA") is None else str(x["ratingA"])),
        '"poles": ' + ("null" if x.get("poles") is None else str(x["poles"])),
        '"icuFromDesc": ' + ("null" if x.get("icuFromDesc") is None else str(x["icuFromDesc"])),
        '"kw": ' + ("null" if x.get("kw") is None else j(x["kw"])),
        '"ma": ' + ("null" if x.get("ma") is None else str(x["ma"])),
    ]
    return "{ " + ", ".join(parts) + " }"

_t = next(x for x in brk["items"] if x["ref"] == "TABEAAANN")
_g = next(x for x in brk["items"] if x["ref"] == "G12T3F16")
_a = next(x for x in brk["items"] if x["ref"] == "ATV320U04N4B")
_l = next(x for x in brk["items"] if x["ref"] == "LC1DT20M7")
_r = next(x for x in brk["items"] if x["ref"] == "R9R51225")

brk_ts = """/**
 * SCHNEIDER ELECTRIC EGYPT — BREAKERS & SWITCHES PRICE LIST 2026 KNOWLEDGE BASE
 *
 * GENERATED FILE (scripts/gen_refs_kb_ts.py) — do not hand-edit.
 * Source: "Breakers and SWITCHES .pdf" (319 pages, Version 1 - Feb 2026,
 * prices in EGP NOT including VAT). Parsed price-anchored from word
 * coordinates: reference (Product ID) + price + description + part (TOC).
 * Split references (ID cell wrapped over two lines) were re-joined and
 * noted; numeric accessory references (e.g. 47383) parsed as-is.
 *
 * Citation format: [Schneider Electric Egypt — Breakers & Switches Price List 2026، <Part>، ص.<P>، Product ID: <REF>]
 */

export interface SchneiderItem {
  ref: string;
  price: number;
  /** Small printed number on ACB/MCCB rows (= Icu kA on those tables). */
  auxA: number | null;
  page: number;
  part: string;
  subsection: string;
  desc: string;
  ratingA: number | null;
  poles: number | null;
  icuFromDesc: number | null;
  kw: number | null;
  ma: number | null;
}

export const SCHNEIDER_META = {
  doc: "Schneider Electric Egypt — Breakers and Switches Price List 2026 (se.com/eg), Version 1 - Feb 2026",
  citationFormat: "[Schneider Electric Egypt — Breakers & Switches Price List 2026، <Part>، ص.<P>، Product ID: <REF>]",
  citationFormatEn: "[Schneider Electric Egypt — Breakers & Switches Price List 2026, <Part>, p.<P>, Product ID: <REF>]",
  pages: """ + str(brk["meta"]["pages"]) + """,
  currency: "EGP (not including VAT) — قائمة Version 1 - Feb 2026",
  parts: """ + j(brk["meta"]["parts"]).replace("None", "null") + """ as Array<[number, string]>,
} as const;

const SCHNEIDER_ITEMS_PARTS: SchneiderItem[][] = [
  """ + ",\n  ".join("[\n    " + ",\n    ".join(brk_item(x) for x in brk["items"][i:i + 250]) + "\n  ]" for i in range(0, len(brk["items"]), 250)) + """
];

export const SCHNEIDER_ITEMS: SchneiderItem[] = SCHNEIDER_ITEMS_PARTS.flat();

export const SCHNEIDER_INTEGRITY_SAMPLER = {
  itemCount: """ + str(len(brk["items"])) + """,
  tabeaaann: """ + j(_t["price"]) + """,
  g12t3f16: """ + j(_g["price"]) + """,
  atv320u04n4b: """ + j(_a["price"]) + """,
  lc1dt20m7: """ + j(_l["price"]) + """,
  r9r51225: """ + j(_r["price"]) + """,
  pages: """ + str(brk["meta"]["pages"]) + """,
} as const;
"""

open(f"{OUT}/chatbot-schneider-kb.ts", "w", encoding="utf-8").write(brk_ts)
print("→ chatbot-schneider-kb.ts", len(brk_ts), "chars")

# ════════════════════════════════════════════════════════════════════════════
# 4) chatbot-refs-pages-kb.ts — full page-level index of ALL seven documents
# ════════════════════════════════════════════════════════════════════════════

pages = json.load(open(f"{KB}/refs_pages.json", encoding="utf-8"))
chunks = pages["chunks"]

def chunk_row(c):
    parts = [
        '"doc": ' + ts_str(c["doc"]),
        '"page": ' + str(c["page"]),
        '"part": ' + ("null" if c.get("part") is None else str(c["part"])),
        '"chapter": ' + ("null" if c.get("chapter") is None else str(c["chapter"])),
        '"table": ' + ("null" if c.get("table") is None else str(c["table"])),
        '"chunk": ' + str(c["chunk"]),
        '"image": ' + ("true" if c.get("image") else "false"),
        '"text": ' + ts_str(c["text"]),
    ]
    return "{ " + ", ".join(parts) + " }"

docs_stats = pages["meta"]["docs"]
total_chunks = len(chunks)

pages_ts = """/**
 * FULL PAGE-LEVEL INDEX — every page of every reference document, chunked for
 * BM25 retrieval. NOTHING is omitted: pages whose text cannot be extracted
 * (scanned/image tiles) are recorded as image=true placeholders with their
 * position, so the assistant always knows what exists where and can cite it.
 *
 * GENERATED FILE (scripts/gen_refs_kb_ts.py) — do not hand-edit.
 *
 * Documents (doc ids):
 *  saudi-dps   — SEC DPS-01 Estimation of Customer Load Guideline (46 pages)
 *  abb-tr      — ABB Distribution Transformers catalogue (51 pages)
 *  egycode-1   — الدليل الإرشادي للكود المصري، المجلد الأول، Ch1-6 (140 pages)
 *  egycode-2   — الدليل الإرشادي للكود المصري، المجلد الأول، Ch7-11 (167 pages; 64 image pages)
 *  elsewedy    — Elsewedy Electric Power Cables Catalogue (191 pages)
 *  gilany      — هندسة القوى الكهربية، أ.د. محمود جيلاني 2019 (957 pages)
 *  schneider-brk — Schneider Egypt Breakers & Switches Price List 2026 (319 pages)
 *
 * Page numbers = PDF page numbers (printed page where identical).
 */

export interface RefsPageChunk {
  doc: string;
  page: number;
  /** Detected الباب (Arabic book part) where the running header carries it. */
  part: number | null;
  /** Detected الفصل where present. */
  chapter: number | null;
  /** Elsewedy printed table number where the page announces one. */
  table: number | null;
  chunk: number;
  /** true = scanned/image page (no extractable text — recorded, not skipped). */
  image: boolean;
  text: string;
}

export const REF_PAGES_META = {
  totalChunks: """ + str(total_chunks) + """,
  docs: """ + j(docs_stats).replace("None", "null") + """,
} as const;

export const REF_PAGES_CHUNKS: RefsPageChunk[] = [
  """ + ",\n  ".join(chunk_row(c) for c in chunks) + """
];

export const REF_PAGES_INTEGRITY_SAMPLER = {
  totalChunks: """ + str(total_chunks) + """,
  gilanyChunks: """ + str(docs_stats.get("gilany", {}).get("chunks", 0)) + """,
  egycode2ImagePages: """ + str(docs_stats.get("egycode-2", {}).get("imagePages", 0)) + """,
  elsewedyChunks: """ + str(docs_stats.get("elsewedy", {}).get("chunks", 0)) + """,
  schneiderChunks: """ + str(docs_stats.get("schneider-brk", {}).get("chunks", 0)) + """,
  dpsChunks: """ + str(docs_stats.get("saudi-dps", {}).get("chunks", 0)) + """,
} as const;
"""

open(f"{OUT}/chatbot-refs-pages-kb.ts", "w", encoding="utf-8").write(pages_ts)
print("→ chatbot-refs-pages-kb.ts", len(pages_ts), "chars")

print("GENERATION OK")
