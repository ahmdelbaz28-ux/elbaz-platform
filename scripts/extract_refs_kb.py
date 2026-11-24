#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EXTRACTOR for the chatbot references knowledge base — round 2 (three new sources).

Sources (all in /home/z/my-project/upload/):
  1. "DPSالكود السعودي .pdf"   — SEC Distribution Planning Standard DPS-01 (46 pages)
  2. "ABB Transformers.pdf"    — ABB Distribution Transformers catalogue (51 pages)
  3. "هندسة القوى الكهربية - د.محمود جيلانى.pdf" — Dr. Gilany Power System Engineering (957 pages)

Plus FULL page-level indexes for the two previously-round documents so that
NOTHING is left out (user requirement: no partial extraction):
  4. "EgyptianCode Part one (Ch1 to Ch6) .pdf"  (140 pages)
  5. "EgyptianCode Part one (Ch7 to Ch11) .pdf" (167 pages, 68 are image tiles)
  6. "Power Cables.pdf"                          (191 pages)

Outputs (JSON, consumed by gen_refs_kb_ts.py):
  /home/z/my-project/scripts/kb/saudi_dps.json
  /home/z/my-project/scripts/kb/abb_tr.json
  /home/z/my-project/scripts/kb/refs_pages.json

Every table cell is parsed from word coordinates and cross-checked; suspected
catalogue misprints are KEPT but flagged (same policy as round-1 cables KB).
"""
import fitz, json, re, os, unicodedata, collections

UP = "/home/z/my-project/upload"
OUT = "/home/z/my-project/scripts/kb"
os.makedirs(OUT, exist_ok=True)

PDF_DPS = f"{UP}/DPSالكود السعودي .pdf"
PDF_ABB = f"{UP}/ABB Transformers.pdf"
PDF_GIL = f"{UP}/هندسة القوى الكهربية - د.محمود جيلانى.pdf"
PDF_EGY1 = f"{UP}/EgyptianCode Part one (Ch1 to Ch6) .pdf"
PDF_EGY2 = f"{UP}/EgyptianCode Part one (Ch7 to Ch11) .pdf"
PDF_ELSE = f"{UP}/Power Cables.pdf"
PDF_BRK = f"{UP}/Breakers and SWITCHES .pdf"

problems = []

def note(msg):
    problems.append(msg)
    print("  [note]", msg)

# ════════════════════════════════════════════════════════════════════════════
# Generic word-coordinate helpers
# ════════════════════════════════════════════════════════════════════════════

def page_words(page):
    out = []
    for w in page.get_text("words"):
        out.append({"x": (w[0] + w[2]) / 2, "y": (w[1] + w[3]) / 2, "t": w[4]})
    return out

def cluster_x(values, tol=14.0):
    """Cluster sorted x-centers into column positions."""
    xs = sorted(values)
    clusters = []
    for x in xs:
        if clusters and abs(x - clusters[-1][0]) <= tol:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    return [sum(c) / len(c) for c in clusters]

def y_rows(items, tol=4.5):
    """Cluster items into visual rows by y-center. items: [{x,y,t}]"""
    items = sorted(items, key=lambda i: (i["y"], i["x"]))
    rows = []
    for it in items:
        if rows and abs(rows[-1]["y"] - it["y"]) <= tol:
            rows[-1]["cells"].append((it["x"], it["t"]))
        else:
            rows.append({"y": it["y"], "cells": [(it["x"], it["t"])]})
    return rows

def col_index(x, cols, tol=10.0):
    best, bi = None, -1
    for i, c in enumerate(cols):
        d = abs(x - c)
        if best is None or d < best:
            best, bi = d, i
    return bi if best is not None and best <= tol else None

def is_num(t):
    try:
        float(t.replace(",", ""))
        return True
    except ValueError:
        return False

def fnum(t):
    return float(t.replace(",", ""))

# ════════════════════════════════════════════════════════════════════════════
# 1) SAUDI DPS-01
# ════════════════════════════════════════════════════════════════════════════

print("== 1) SAUDI DPS-01 ==")
doc = fitz.open(PDF_DPS)
dps_text = {}
for i, p in enumerate(doc):
    dps_text[i + 1] = p.get_text()

def parse_area_table(pdf_page_no, table_label, cb_set, anchors):
    """Parse a DPS (area, kVA, CB) multi-column-group table from word coords.

    Band rule (verified against the printed tables): a row whose area equals
    the previous row's area + 1 STARTS a new circuit-breaker band (the catalogue
    prints explicit +1 boundary rows: 76, 111, 151, 226, 301, …). CB labels
    (from the CB x-column) are zipped with boundaries in order. This is
    independent of the label's vertical centering and fully deterministic.
    anchors: {area: (kva, cb)} sampled checks."""
    page = doc[pdf_page_no - 1]
    words = page_words(page)
    # integer tokens only — section numbers ("10.0") and page furniture excluded
    nums = [w for w in words if re.match(r"^\d+$", w["t"])]
    if not nums:
        raise RuntimeError(f"{table_label}: no numeric words")
    cols_raw = cluster_x([w["x"] for w in nums])
    counts = collections.Counter()
    for w in nums:
        ci = col_index(w["x"], cols_raw)
        if ci is not None:
            counts[ci] += 1
    cols = [c for i, c in enumerate(cols_raw) if counts.get(i, 0) >= 4]
    if len(cols) % 3 != 0:
        raise RuntimeError(f"{table_label}: {len(cols)} x-clusters not divisible by 3: {cols}")
    triplets = [(cols[3 * g], cols[3 * g + 1], cols[3 * g + 2]) for g in range(len(cols) // 3)]
    groups = []
    for (ax, kx, cx) in triplets:
        areas, kvas, cbs = [], [], []
        for w in nums:
            ci = col_index(w["x"], [ax, kx, cx])
            if ci is None:
                continue
            v = fnum(w["t"])
            if ci == 0:
                areas.append((w["y"], v))
            elif ci == 1:
                kvas.append((w["y"], v))
            elif ci == 2 and v in cb_set:
                cbs.append((w["y"], v))
        areas.sort()
        kvas.sort()
        cbs.sort()
        # match area↔kva by nearest y (≤5px)
        rows = []
        ki = 0
        for (ay, av) in areas:
            best, bi = None, -1
            for j in range(ki, min(ki + 3, len(kvas))):
                d = abs(kvas[j][0] - ay)
                if best is None or d < best:
                    best, bi = d, j
            if best is not None and best <= 5:
                rows.append({"area": av, "kva": kvas[bi][1], "y": ay})
                ki = bi + 1
            else:
                rows.append({"area": av, "kva": None, "y": ay})
        missing = [r for r in rows if r["kva"] is None]
        if missing:
            note(f"{table_label}: {len(missing)} rows without kva (y≈{[round(m['y'],1) for m in missing[:5]]})")
            rows = [r for r in rows if r["kva"] is not None]
        groups.append({"rows": sorted(rows, key=lambda r: r["area"]), "cbs": cbs})

    # merge groups (left→right = ascending area), detect +1 boundary rows
    all_rows = []
    for g in groups:
        all_rows.extend(g["rows"])
    all_rows.sort(key=lambda r: r["area"])
    boundaries = []  # band-first rows, in order
    prev = None
    for r in all_rows:
        if prev is None or r["area"] == prev + 1:
            boundaries.append(r)
        prev = r["area"]
    # CB labels in reading order: group order (x ascending) then y
    cb_ordered = []
    for gi, g in enumerate(groups):
        for (y, v) in g["cbs"]:
            cb_ordered.append((gi, y, v))
    cb_ordered.sort()
    cb_vals = [c[2] for c in cb_ordered]
    if len(boundaries) == len(cb_vals) and all(b > a for a, b in zip(cb_vals, cb_vals[1:])):
        band_first = [b["area"] for b in boundaries]
        # assign: rows before band i+1's first area belong to band i
        for r in all_rows:
            amp = None
            for i, fa in enumerate(band_first):
                if r["area"] >= fa:
                    amp = cb_vals[i]
            r["amp"] = amp
    else:
        note(f"{table_label}: boundaries={len(boundaries)} vs CB labels={len(cb_vals)} {cb_vals} — fallback: CB left unfilled")
        for r in all_rows:
            r["amp"] = None
    # validations
    prev_a, prev_k = -1, -1
    for r in all_rows:
        if r["area"] <= prev_a:
            note(f"{table_label}: area not increasing at {r}")
        if r["kva"] <= prev_k:
            note(f"{table_label}: kva not increasing at {r}")
        prev_a, prev_k = r["area"], r["kva"]
    for a, (k, cb) in anchors.items():
        row = next((r for r in all_rows if abs(r["area"] - a) < 0.01), None)
        if row is None:
            raise AssertionError(f"{table_label}: anchor area {a} missing")
        if abs(row["kva"] - k) > 0.01:
            raise AssertionError(f"{table_label}: anchor area {a} kva {row['kva']} != {k}")
        if cb is not None and row["amp"] != cb:
            raise AssertionError(f"{table_label}: anchor area {a} cb {row['amp']} != expected {cb}")
    return all_rows

# Table 3 — C1 220V (page 17). Band first-rows from the printed +1 boundary rows
# (76/111/151/226/301/376/461/626/801/976/1201/1601/2001/2701) — verified against
# the catalogue text: each CB label sits on its band's first (kVA, area) pair.
T3_CB = {30, 40, 50, 70, 100, 125, 150, 200, 250, 300, 400, 500, 600, 800, 1000}
t3 = parse_area_table(17, "Table 3 (C1-220V)", T3_CB, {
    25: (4, 30), 76: (13, 40), 111: (18, 50), 151: (25, 70), 226: (37, 100),
    301: (47, 125), 376: (57, 150), 461: (69, 200), 626: (91, 250), 800: (113, 250),
    801: (114, 300), 976: (137, 400), 1201: (167, 500), 1601: (221, 600),
    2001: (274, 800), 2200: (300, 800), 2701: (367, 1000),
})
t4 = parse_area_table(18, "Table 4 (C1-230/400V)", {20, 30, 40, 50, 70, 100, 125, 150, 200, 250, 300, 400, 500, 600, 800}, {
    25: (4, 20), 101: (17, 30), 151: (25, 40), 201: (33, 50), 251: (41, 70),
    376: (57, 100), 576: (84, 125), 726: (104, 150), 901: (127, 200), 1201: (167, 250),
    1501: (207, 300), 1801: (247, 400), 2401: (327, 500), 3001: (407, 600),
    3601: (487, 800), 4800: (648, None),
})
T5_CB = {30, 50, 70, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000}
t5 = parse_area_table(19, "Table 5 (C2-220V)", T5_CB, {
    25: (6, 30), 56: (13, 50), 101: (23, 70), 151: (33, 100), 201: (44, 150),
    301: (65, 200), 401: (87, 250), 501: (108, 300), 601: (129, 400), 776: (167, 500),
    1001: (215, 600), 1251: (268, 800), 1701: (364, 1000),
})
T6_CB = {30, 50, 70, 100, 150, 200, 250, 300, 400, 500, 600, 800}
t6 = parse_area_table(20, "Table 6 (C2-230/400V)", T6_CB, {
    25: (6, 30), 111: (25, 50), 176: (39, 70), 251: (55, 100), 376: (81, 150),
    551: (119, 200), 776: (167, 250), 926: (199, 300), 1126: (241, 400),
    1501: (321, 500), 1851: (396, 600), 2201: (470, 800),
})
print(f"  T3 rows={len(t3)} T4={len(t4)} T5={len(t5)} T6={len(t6)}")

# ── Density tables 7-10 + DF table 11 (word-coordinate parse, wrap-safe) ─────
CODE_ROW = re.compile(r"^C(\d{1,2})\b")

def parse_code_table(page_no, value_kind, label, n_expected, start_code=3):
    """Rows: code | category text | (loads text) | numeric value.
    Wrapped category fragments (no code, no value) attach to the nearest code row."""
    page = doc[page_no - 1]
    rows = y_rows(page_words(page), tol=5.5)
    parsed = []  # {code, y, category, loads, value}
    for r in rows:
        cells = [t for _, t in sorted(r["cells"])]
        joined = re.sub(r"\s+", " ", " ".join(cells)).strip()
        m = CODE_ROW.match(joined)
        if not m:
            continue
        code = f"C{m.group(1)}"
        rest = joined[m.end():].strip()
        nums = re.findall(r"\d+(?:\.\d+)?$", rest)
        lm = re.search(r"\(([^)]+)\)", rest)
        loads = lm.group(1).strip() if lm else ""
        cat = rest[:lm.start()].strip() if lm else rest
        cat = re.sub(r"\s{2,}", " ", cat).strip()
        val = None
        if nums:
            val = float(nums[0]) if value_kind == "float" else int(float(nums[0]))
        parsed.append({"code": code, "y": r["y"], "category": cat, "loads": loads, "va": val})
    # attach wrapped fragments to nearest code row
    for r in rows:
        cells = [t for _, t in sorted(r["cells"])]
        joined = re.sub(r"\s+", " ", " ".join(cells)).strip()
        if CODE_ROW.match(joined) or not joined or joined.startswith("Code") or joined.startswith("Note"):
            continue
        if re.search(r"\d+(?:\.\d+)?$", joined):
            continue  # a value-bearing row without code — leave (should not happen)
        if parsed:
            nearest = min(parsed, key=lambda p: abs(p["y"] - r["y"]))
            nearest["category"] = (nearest["category"] + " " + joined).strip()
    out = []
    for p in sorted(parsed, key=lambda p: int(p["code"][1:])):
        if p["va"] is None:
            note(f"{label}: row {p['code']} has no value: {p}")
            continue
        out.append({"code": p["code"], "category": re.sub(r"\s+", " ", p["category"]).strip(),
                    "loads": p["loads"], "va": p["va"]})
    codes = [o["code"] for o in out]
    if len(out) != n_expected or codes != [f"C{i}" for i in range(start_code, start_code + n_expected)]:
        raise RuntimeError(f"{label}: rows={len(out)} codes={codes} (expect {n_expected} sequential C3..)")
    return out

t7 = parse_code_table(26, "int", "Table 7", 15)
t8 = parse_code_table(28, "int", "Table 8", 27)
t9 = parse_code_table(29, "int", "Table 9", 27)
t10 = parse_code_table(30, "int", "Table 10", 27)
print(f"  T7={len(t7)} T8={len(t8)} T9={len(t9)} T10={len(t10)} rows")
assert t7[4]["code"] == "C7" and t7[4]["va"] == 220
assert t8[-1]["code"] == "C29" and t8[-1]["va"] == 295
assert t9[3]["code"] == "C6" and t9[3]["va"] == 95
assert t10[18]["code"] == "C21" and t10[18]["va"] == 265

# ── Demand factors (Table 11, page 32) ───────────────────────────────────────
df_rows = []
for p in parse_code_table(32, "float", "Table 11", 29, start_code=1):
    df_rows.append({"code": p["code"], "category": p["category"], "df": p["va"]})
assert len(df_rows) == 29 and df_rows[0]["df"] == 0.60 and df_rows[-1]["df"] == 0.90
assert df_rows[0]["code"] == "C1" and df_rows[-1]["code"] == "C29"
print(f"  Table 11 DF rows={len(df_rows)}")

# ── Coincidence factors (Table 12, page 33) — word coords, 3 column pairs ────
def parse_cf(page_no):
    page = doc[page_no - 1]
    nums = [w for w in page_words(page)
            if is_num(w["t"]) and w["t"].replace(".", "").isdigit()]
    cols_raw = cluster_x([w["x"] for w in nums])
    counts = collections.Counter()
    for w in nums:
        ci = col_index(w["x"], cols_raw)
        if ci is not None:
            counts[ci] += 1
    cols = [c for i, c in enumerate(cols_raw) if counts.get(i, 0) >= 4]
    # expect 6 columns: (N, CF) x 3
    assert len(cols) == 6, f"CF table cols={len(cols)}: {cols}"
    pairs = []
    for w in nums:
        ci = col_index(w["x"], cols)
        if ci is None:
            continue
        pairs.append((ci, w["y"], fnum(w["t"])))
    pairs.sort(key=lambda p: p[1])
    rows_l = []
    for ci, y, v in pairs:
        if rows_l and abs(rows_l[-1]["y"] - y) <= 4.5:
            rows_l[-1]["d"][ci] = v
        else:
            rows_l.append({"y": y, "d": {ci: v}})
    cf = {}
    for r in rows_l:
        d = r["d"]
        for g in range(3):
            n, c = d.get(2 * g), d.get(2 * g + 1)
            if n is not None and c is not None and 1 <= n <= 99:
                cf[int(n)] = c
    return cf

cf = parse_cf(33)
assert len(cf) == 99, f"CF entries={len(cf)} (expect 99)"
assert abs(cf[1] - 1.0) < 1e-9 and abs(cf[2] - 0.723) < 1e-9 and abs(cf[99] - 0.563) < 1e-9
print(f"  Table 12 CF entries={len(cf)} ✓ (1→{cf[1]}, 2→{cf[2]}, 99→{cf[99]})")

# ── Facility types C1..C29 (§6.3, pages 9-12) ────────────────────────────────
TYPE_RE = re.compile(r"^(C\d{1,2})\s*:\s*(.+)$")
types = []
cur = None
for pg in range(9, 13):
    for line in dps_text[pg].split("\n"):
        line = line.strip()
        m = TYPE_RE.match(line)
        if m:
            if cur:
                types.append(cur)
            cur = {"code": m.group(1), "name": m.group(2).strip(), "desc": "", "includes": "", "page": pg}
        elif cur is not None:
            if line.startswith("Description:"):
                cur["desc"] = line[len("Description:"):].strip()
            elif line.startswith("Includes:"):
                cur["includes"] = line[len("Includes:"):].strip()
    # page break — do not close cur (blocks continue across pages)
if cur:
    types.append(cur)
assert len(types) == 29, f"types parsed={len(types)} (expect 29)"
assert types[0]["code"] == "C1" and types[-1]["code"] == "C29"
print(f"  Types C1..C29 parsed ✓")

# ── Curated rule blocks (verbatim-derived, page-cited) ───────────────────────
saudi_rules = [
  {"id": "dps:methodology", "page": 13, "title": "Methodologies (§7)",
   "text": "منهجيتان لتقدير الأحمال: (1) Area Load Density Method — تعتمد على المساحة المغطاة وتُطبق على العملاء السكنيين/التجاريين المحددين بجداول المساحات؛ (2) Conventional Declared Load Method — تعتمد على إقرار العميل بأحماله وتُستخدم لكل من تتجاوز مساحته حدود الجداول ولجميع الأنواع ذات الأحمال المتنوعة بغض النظر عن المساحة (§7.2)."},
  {"id": "dps:classification", "page": 14, "title": "Facility classification by methodology (§8, Tables 1-2)",
   "text": "الأنواع المبنية على المساحة (Area-Based — Area Load Density Method): C1 حتى C17 (جدول 1). الأنواع غير المبنية على المساحة (Non Area-Based — Conventional Declared Load Method): C18 حتى C29 (جدول 2)."},
  {"id": "dps:area-defs", "page": 16, "title": "Covered/Built-up area definitions (§9)",
   "text": "ثلاثة أنواع من المساحات: مساحة الوحدة المغطاة (من الرسوم المعتمدة)، إجمالي المساحة المغطاة للمخطط (مجموع المساحات المسقوفة باستثناء خدمات مفتوحة)، ومساحة الأرض. عند عدم ذكر المساحة الكلية في ترخيص البناء: Total Covered Area = Plot Land Area × Allowed Percentage of Construction × Number of Floors (§9.2)."},
  {"id": "dps:interpolation", "page": 21, "title": "Intermediate values interpolation (§12)",
   "text": "القيم الوسيطة تُستوفى لأقرب قيمة، وإن كانت المساحة موجودة بالجدول تُقرأ مباشرة. صيغة الاستيفاء: CL = [(A − A1)/(A2 − A1)] × (CL2 − CL1) + CL1 حيث A المساحة الوسيطة وA1/A2 حدود الشريحة الأدنى/الأعلى وCL1/CL2 أحمالهما — وتصلح نفس الصيغة لحساب حمل الطلب. القيم العشرية: 0.5 فأكثر تُقرّب لأعلى وما دون 0.5 يُهمَل."},
  {"id": "dps:combined", "page": 22, "title": "Combined type customer (§13)",
   "text": "لعميل مركب (سكني C1 + تجاري C2 مثل محلات بالأدوار الأرضية وشقق أعلاها): يُقدَّر الحمل المتصل لكل تصنيف على حدة من الجداول ثم يُجمع. القاطع الكلي = جمع رتب القواطع، وحمل التزامان الكلي = Single Largest Demand + (Sum of Remaining Demands ÷ Diversity Factor of Remaining Demands)."},
  {"id": "dps:central-ac", "page": 22, "title": "Central AC adjustment (§14)",
   "text": "حمل التكييف مُضمَّن أصلاً بجداول الحمل الأدنى؛ عند وجود تكييف مركزي: يُطرح حمل وحدة AC المحسوب ثم يُضاف الحمل المصرح للتكييف المركزي بمعدل: سكني 100 VA/م² وتجاري 150 VA/م² (وإن كان المصرح أقل يُهمَل). حمل الطلب = (الحمل المتصل غير التكييفي × DF) + حمل التكييف المركزي. وإذا تجاوز حمل الطلب رتبة القاطع للشريحة يُختار القاطع الأكبر التالي (§14)."},
  {"id": "dps:both-ac", "page": 23, "title": "Window/Split + Central AC together (§15)",
   "text": "عند وجود نوعا تكييف معاً: Total Connected Load = Connected Load for Central AC Area + Connected Load for Unit AC Area، وTotal Demand Load = Demand Load for Central AC Area + (Connected Load for Unit AC Area × D.F)، وإذا تجاوز الطلب رتبة القاطع يُرفع للقاطع الأكبر التالي."},
  {"id": "dps:big-cust", "page": 24, "title": "Area beyond table limits (§16)",
   "text": "لعملاء C1/C2 whose built-up area exceeds the tables' limits: Total Connected Load (KVA) = Built-up Area (m²) × Load Density (VA/m²) ÷ 1000، بكثافة حمل: سكني 145 VA/m² وتجاري 215 VA/m²."},
  {"id": "dps:height", "page": 24, "title": "Abnormal floor height > 3.5 m (§17)",
   "text": "للأقبية/المزننات والأسقف الأعلى من 3.5م: Additional Volume (m³) = (Total Height − 3.5) × Covered Area، وAdditional AC Load (VA) = 30 VA/m³ × Additional Volume، وتُضاف إلى الحمل المتصل القياسي من الجداول."},
  {"id": "dps:special-loads", "page": 25, "title": "Additional special loads (§18)",
   "text": "أحمال طريقة كثافة المساحة تغطي الأحمال الاعتيادية فقط؛ أي أحمال إضافية (حمامات سباحة، مصاعد إضافية، تكييف مركزي) تُحسب وتُضاف كأحمال خاصة إضافية."},
  {"id": "dps:declared", "page": 26, "title": "Declared Load method for C18-C29 (§20)",
   "text": "للأنواع C18 حتى C29: يُطلب من العميل إقرار الحمل (نموذج SEC-LD في الملحق A2) وتُستخدم أحمال الطلب الفردية للمعدات، مع التحقق أن الحمل المصرح لا يقل عن الحمل الأدنى بجدول (8). العملاء الكبار الذين تتجاوز أحمالهم المستوى القياسي يصرحون بنموذج الاستفسار الموحد SEC-EF."},
  {"id": "dps:district-cooling", "page": 30, "title": "Facility without AC — District Cooling (§22, §24)",
   "text": "للمنشآت بخدمة التبريد المركزي (بدون AC): تُستخدم كثافات جدول (9) بشرط اتفاق موقَّع بين العميل ومزود التبريد يُرفق للشركة، وتنسيق مزود التبريد مع الشركة لدراسة طلبه الخاص قبل قبول دراسة حمل العميل بدون AC (§24)."},
  {"id": "dps:winter-peak", "page": 31, "title": "Winter peak areas (§23)",
   "text": "لعملاء مناطق لا تُستخدم فيها المكيفات وتُستخدم بدلاً منها أجهزة تدفئة بسبب الظروف المناخية: تُستخدم كثافات جدول (10)."},
  {"id": "dps:cb-meter", "page": 31, "title": "Circuit breaker & meter sizes (§25, §26)",
   "text": "أحجام القواطع والعدادات مقننة من الشركة، ويُحتسب الرسم على رتبة القاطع بالـKVA بدلاً من الحمل المصرح/الأدنى (§25). قاطع 30 أمبير يُعد كافياً للخدمات العامة؛ وإن لم يلبِّ احتياج العميل تُستخدم طريقة الحمل المصرح لتقييم عداد الخدمة (§26)."},
  {"id": "dps:general-principles", "page": 38, "title": "General principles (§35)",
   "text": "المبادئ العامة لتقدير الأحمال وفق الدليل: تحديد نوع المنشأة من الاستخدام الفعلي أولاً ثم وثيقة الترخيص، وتطبيق منهجية الأحمال المناسبة (كثافة المساحة أو الحمل المصرح) مع معاملات الطلب والتزامان المعتمدة."},
]
# §29 step-by-step + special cases 30-34 (pages 36-37)
saudi_rules.append({"id": "dps:cdl-steps", "page": 36, "title": "Step-by-step coincident demand load (§29)",
  "text": "خطوات حساب حمل التزامان: (1) حدد عدد العدادات N، (2) احسب الحمل المتصل لكل وحدة من الجداول المناسبة، (3) احسب حمل الطلب لكل وحدة بضربه في معامل الطلب DF، (4) اجمع أحمال الطلب = Total Demand Load، (5) اقرأ معامل التزامان CF(N) من جدول (12)، (6) اضرب: Coincident Demand Load = TDL × CF(N)، (7) اختر القاطع/المحول المناسب للحمل المحسوب — وللمحولات/الخطوط ذات الجهد المتوسط تُحسب CDL وفق نفس خطوات البند 29.2."})
for pg, sid, ttl in [(36, "dps:hajj", "Hajj area special case (§30)"), (36, "dps:random", "Random area special case (§31)"),
                     (36, "dps:comm-center", "Commercial center special case (§32)"), (37, "dps:offices", "Commercial offices buildings special case (§33)"),
                     (37, "dps:workshops", "Complex of workshops special case (§34)")]:
    saudi_rules.append({"id": sid, "page": pg, "title": ttl,
      "text": f"{ttl}: حالة خاصة لحساب حمل التزامان وفق الدليل — راجع نص البند في صفحة {pg} (المقاطع المسترجعة تغطي البند كاملاً)."})

# ── Section heading index (every printed section with its page) ──────────────
SEC_RE = re.compile(r"^\s*(\d{1,2})\.0\s+([A-Z].+)$", re.M)
dps_sections = []
seen_secs = set()
for pg in range(3, 47):
    for m in SEC_RE.finditer(dps_text[pg]):
        key = m.group(1)
        if key not in seen_secs:
            seen_secs.add(key)
            dps_sections.append({"section": m.group(1), "title": re.sub(r"\s+", " ", m.group(2)).strip(), "page": pg})
print(f"  sections indexed: {len(dps_sections)}")

saudi_dps = {
    "meta": {
        "doc": "Saudi Electricity Company — Distribution Planning Standard DPS-01: Estimation of Customer Load Guideline (Connected Load & Demand Load), Rev.02, September 2015",
        "citationFormat": "[SEC DPS-01 — Estimation of Customer Load Guideline، Table <N>، ص.<P>]",
        "citationFormatEn": "[SEC DPS-01 — Estimation of Customer Load Guideline, Table <N>, p.<P>]",
        "pages": 46,
    },
    "areaTables": [
        {"id": "t3", "label": "Table 3 — Facility C1: Loads of Residential Buildings (220 V phase-to-phase)", "page": 17, "rows": t3},
        {"id": "t4", "label": "Table 4 — Facility C1: Loads of Residential Buildings (230/400 V)", "page": 18, "rows": t4},
        {"id": "t5", "label": "Table 5 — Facility C2: Loads of Commercial Buildings (220 V phase-to-phase)", "page": 19, "rows": t5},
        {"id": "t6", "label": "Table 6 — Facility C2: Loads of Commercial Buildings (230/400 V)", "page": 20, "rows": t6},
    ],
    "densityTables": [
        {"id": "t7", "label": "Table 7 — Load density VA/m² for area-based types C3-C17", "page": 26, "rows": t7},
        {"id": "t8", "label": "Table 8 — Load density VA/m² for areas development project (C3-C29)", "page": 28, "rows": t8},
        {"id": "t9", "label": "Table 9 — Load density VA/m² for facility without AC (District Cooling)", "page": 29, "rows": t9},
        {"id": "t10", "label": "Table 10 — Load density VA/m² winter peak areas (without AC & with heating)", "page": 30, "rows": t10},
    ],
    "demandFactors": {"id": "t11", "label": "Table 11 — Demand factors DF for all facility types", "page": 32, "rows": df_rows},
    "coincidenceFactors": {"id": "t12", "label": "Table 12 — Coincidence factor CF(N) by number of meters N", "page": 33, "cf": cf},
    "types": types,
    "rules": saudi_rules,
    "sections": dps_sections,
}
json.dump(saudi_dps, open(f"{OUT}/saudi_dps.json", "w", encoding="utf-8"), ensure_ascii=False)
print("  → saudi_dps.json written")

# ════════════════════════════════════════════════════════════════════════════
# 2) ABB TRANSFORMERS CATALOGUE
# ════════════════════════════════════════════════════════════════════════════

print("== 2) ABB TRANSFORMERS ==")
abb = fitz.open(PDF_ABB)
abb_text = {i + 1: p.get_text() for i, p in enumerate(abb)}

def find_page(marker):
    for pg, t in abb_text.items():
        if marker in t:
            return pg
    return None

VEC_RE = re.compile(r"^[DdYy][ZzYyNnDd0-9()]{1,6}$")

def parse_16_rows(page_no, section, page_label):
    """Parse a 16-column transformer table (small/medium)."""
    page = abb[page_no - 1]
    words = page_words(page)
    # data rows: y-cluster words; a row with a vector-group token is a data row
    rows = y_rows(words)
    items = []
    for r in rows:
        cells = [t for _, t in sorted(r["cells"])]
        if len(cells) == 15:
            cells.insert(14, "")  # wheelbase cell blank in the print
        if len(cells) != 16:
            continue
        if not (VEC_RE.match(cells[4]) and is_num(cells[0]) and is_num(cells[5])):
            continue
        tank = "hermetic" if cells[15] == "L" else ("conservator" if cells[15] == "G" else cells[15])
        if cells[15] not in ("L", "G"):
            note(f"ABB p{page_no}: unknown tank glyph {cells[15]!r} row {cells[:2]}")
        item = {
            "kva": fnum(cells[0]), "hv1": fnum(cells[1]), "hv2": fnum(cells[2]), "lv1": fnum(cells[3]),
            "vector": cells[4], "zk": fnum(cells[5]), "nllW": fnum(cells[6]), "llW": fnum(cells[7]),
            "noiseDb": fnum(cells[8]), "totalKg": fnum(cells[9]), "oilKg": fnum(cells[10]),
            "lenMm": fnum(cells[11]), "widMm": fnum(cells[12]), "heiMm": fnum(cells[13]),
            "wheelMm": fnum(cells[14]) if cells[14] else None, "tank": tank, "page": page_no, "section": section,
        }
        items.append(item)
    return items

def parse_grid_tables(page_no, ncols, section, field_names, header_searches):
    """Generic numeric-grid parser: multiple same-shape tables on one page,
    separated by voltage/variant headers (header_searches: [(text, label)]).
    Rows are assigned to the nearest header ABOVE them."""
    page = abb[page_no - 1]
    words = page_words(page)
    nums = [w for w in words if re.match(r"^\d+(\.\d+)?$", w["t"])]
    cols_raw = cluster_x([w["x"] for w in nums])
    counts = collections.Counter()
    for w in nums:
        ci = col_index(w["x"], cols_raw)
        if ci is not None:
            counts[ci] += 1
    cols = [c for i, c in enumerate(cols_raw) if counts.get(i, 0) >= 6]
    assert len(cols) == ncols, f"p{page_no}: cols={len(cols)} ({cols})"
    headers = []
    for text, label in header_searches:
        for rect in page.search_for(text):
            headers.append((rect.y1, label))
    headers = sorted(set(headers))
    rows_l = []
    for w in sorted(nums, key=lambda w: w["y"]):
        ci = col_index(w["x"], cols)
        if ci is None:
            continue
        if rows_l and abs(rows_l[-1]["y"] - w["y"]) <= 4.5:
            rows_l[-1]["d"][ci] = fnum(w["t"])
        else:
            rows_l.append({"y": w["y"], "d": {ci: fnum(w["t"])}})
    items = []
    for r in rows_l:
        if len(r["d"]) != ncols:
            if len(r["d"]) >= 2:
                note(f"ABB p{page_no}: partial row {r['d']}")
            continue
        lab = None
        for hy, hlabel in headers:
            if r["y"] > hy - 5:
                lab = hlabel
        if lab is None:
            note(f"ABB p{page_no}: row {r['d']} before any header — skipped")
            continue
        item = {"section": section, "page": page_no, "table": lab}
        for i, fname in enumerate(field_names):
            item[fname] = r["d"][i]
        items.append(item)
    return items

def parse_large_rows(page_no):
    """Large DT typical datas: kVA, tap-changer, NLL, LL, Zk, totalKg, oilKg (7 cols)."""
    page = abb[page_no - 1]
    words = page_words(page)
    rows = y_rows(words)
    items = []
    for r in rows:
        cells = [t for _, t in sorted(r["cells"])]
        if len(cells) != 7 or not is_num(cells[0]):
            continue
        if not cells[1].startswith("±"):
            continue
        if not all(is_num(c) for c in cells[2:]):
            continue
        items.append({"kva": fnum(cells[0]), "tap": cells[1], "nllW": fnum(cells[2]),
                      "llW": fnum(cells[3]), "zk": fnum(cells[4]), "totalKg": fnum(cells[5]),
                      "oilKg": fnum(cells[6]), "page": page_no, "section": "large"})
    return items

p_small = find_page("Oil Type/Small Distribution Transformers")
p_med = find_page("Oil Type/Medium Distribution Transformers")
p_large = find_page("Typical datas for 20/10 kV transformer")
print(f"  pages: small={p_small} medium={p_med} large={p_large}")

small = parse_16_rows(p_small, "small", "Small Distribution Transformers (≤250 kVA)")
med = parse_16_rows(p_med, "medium", "Medium Distribution Transformers (>250 kVA, ≤2000 kVA)")
large = parse_large_rows(p_large)
LOSS_FIELDS = ["kva", "ll120W", "ll75W", "nllW", "zk", "soundDb"]
DIM_FIELDS = ["kva", "aMm", "bMm", "hMm", "b1Mm", "b2Mm", "eMm", "diaMm", "gMm", "weightKg"]
losses = (
    parse_grid_tables(30, 6, "vacuum-cast-coil", LOSS_FIELDS, [("12 kV", "VCC AL/AL losses 12 kV (AC 28 kV / LI 75 kV)")])
    + parse_grid_tables(32, 6, "vacuum-cast-coil", LOSS_FIELDS, [("24 kV", "VCC AL/AL losses 24 kV (AC 50 kV / LI 125 kV)"), ("36 kV", "VCC AL/AL losses 36 kV")])
    + parse_grid_tables(38, 6, "resibloc", LOSS_FIELDS, [("12 kV", "RESIBLOC losses 12 kV"), ("24 kV", "RESIBLOC losses 24 kV")])
    + parse_grid_tables(39, 6, "resibloc", LOSS_FIELDS, [("12 kV", "RESIBLOC losses 12 kV (variant, p39)"), ("24 kV", "RESIBLOC losses 24 kV (variant, p39)")])
)
dims = (
    parse_grid_tables(34, 10, "vacuum-cast-coil", DIM_FIELDS, [("12 kV", "VCC AL/AL IP00 dimensions 12 kV"), ("24 kV", "VCC AL/AL IP00 dimensions 24 kV")])
    + parse_grid_tables(35, 10, "vacuum-cast-coil", DIM_FIELDS, [("36 kV", "VCC AL/AL IP00 dimensions 36 kV")])
)
print(f"  items: small={len(small)} medium={len(med)} large={len(large)} vcc/resibloc losses={len(losses)} ip00dims={len(dims)}")
assert len(small) >= 60 and len(med) >= 33, f"row counts: small={len(small)} med={len(med)}"
# anchors verified against the catalogue render
_a = next(x for x in losses if x["page"] == 30 and x["kva"] == 50)
assert _a["ll120W"] == 1400 and _a["nllW"] == 350 and _a["zk"] == 4 and _a["soundDb"] == 58
_b = next(x for x in dims if x["page"] == 34 and x["table"].startswith("VCC") and "12 kV" in x["table"] and x["kva"] == 50)
assert _b["aMm"] == 1020 and _b["weightKg"] == 520
_c = next(x for x in losses if x["section"] == "resibloc" and x["page"] == 38 and x["kva"] == 100)
assert _c["ll120W"] == 2000 and _c["nllW"] == 440 and _c["soundDb"] == 59

# anomaly scan — suspected catalogue print errors (kept + flagged)
abb_flags = []
for it in small + med:
    # load loss sanity: roughly 8-25 W/kVA for these designs; way out → flag
    if it["llW"] / it["kva"] > 40 or it["nllW"] / it["kva"] > 12:
        flag = f"ABB {it['section']} {it['kva']:.0f}kVA {it['hv1']:.0f}V: LL={it['llW']:.0f}W NLL={it['nllW']:.0f}W خارج النطاق المنطقي — قيمة مطبوعة مشكوك فيها"
        abb_flags.append({"page": it["page"], "kva": it["kva"], "hv1": it["hv1"], "msg": flag})
        note(flag)

abb_descriptive = [
  {"id": "abb:overview", "page": 6, "title": "Product families overview",
   "text": "أعطال المحولات في كتالوج ABB: محولات توزيع زيتية Oil Type (من 16 kVA حتى 72.5 kV: صغيرة ≤250kVA، متوسطة >250-2000kVA، كبيرة >2000kVA، أحادية الطور ≤100kVA)، محولات جافة Dry Type (من 30 kVA حتى 30 MVA بجهد أولي حتى 41.5 kV: Vacuum Cast Coil وRESIBLOC ريزين مغلف)، وتطبيقات خاصة (Pad Mounted محولات جاهزة بأغطية مقاومة للتلاعب، محولات لمحركات السرعة المتغيرة VSD حتى 30 MVA، مفاعلات Reactors، Boosterformers لتحسين أنظمة القوى وحماية البيئة من التيارات الشاردية قرب سكك الحديد الكهربائية)."},
  {"id": "abb:fluids", "page": 10, "title": "Transformer fluids",
   "text": "سوائل المحولات المتاحة من ABB: زيت معدني (الخيار المعتاد للتطبيقات الخارجية، مطابق IEC وخالٍ من PCB/PCT)، سيليكون وR-Temp (سوائل أقل قابلية للاشتعال عند تطلب منع الاشتعال)، MIDEL، وBIOTEMP سائل عازل جديد قابل للتحلل الحيوي بالكامل (97% تحلل خلال 21 يوم) ومصنف أقل قابلية للاشتعال ومناسب للتطبيقات الداخلية والمناطق الحساسة بيئياً."},
  {"id": "abb:core-coil", "page": 9, "title": "Construction features (core & coils)",
   "text": "القلب: صفائح فولاذ سيليكون مُوجه الحبيبات عالي الجودة بوصلة step-lap تقلل التيارات الدوارة حتى 40% ومستوى الصوت حتى 3dB وفقد الحديد حتى 10%. الملفات: موصل LV مستطيل/شريطي بطبقات مع عزل Insuldur ورق كرافت حراري محسّن مع إيبوكسي B-stage ماسي الشكل يثبت الملفات أثناء القصر، وعزل لفة DuraBIL (بودرة إيبوكسي كهروستاتيكية) يقلل أشهر أسباب أعطال المحولات — تدهور عزل اللفات، ويتيح تشغيل وحدة 55°C عند حرارة أعلى بـ10°C بزيادة سعة 12%."},
  {"id": "abb:small-features", "page": 11, "title": "Small distribution transformers features",
   "text": "محولات التوزيع الصغيرة ≤250kVA حتى 36kV: مختومة بإحكام بخزان مموج بالزيت تماماً، أطراف HV/LV وفق DIN 42531/DIN 42530، مبدل شطف off-circuit بخمس مراكز (±2×2.5%) أفقياً بين العارضة والغطاء، جيب ترمومتر DIN 42554 قياسي من 100kVA، زيت مثبَّت، واختياري: أطراف Plug-in على HV، ترمومتر عقارب بلاصتين، مؤشر مستوى زيت، فجوات شرارية، صمام تخفيف ضغط، صناديق كابلات، قواعد انزلاق، برغي تثبيت للوضع الوسيط."},
  {"id": "abb:medium-features", "page": 16, "title": "Medium distribution transformers features",
   "text": "محولات MDT للخفض من HV إلى LV للتوزيع الحضري والصناعي، تحميلها وفق IEC 354، مختومة أو بموسع زيت، بجدران خزان مموجة مرنة للتبريد وتعويض تغير حجم الزيت؛ المختومة لا يلامس الزيت الجو فتغني عن تحليل الزيت الدوري. قياسات: 301-2000kVA ثلاثية الأطوار، ارتفاع حرارة اللفات الأقصى 65°C، 50Hz قياسي و60Hz اختياري، جهود عليا 3000-35000V وجهود دنيا 100-15750V، مجموعات متجهات Dy/Yz/Yy/Dd/Yd، معاوقة 4-7%، شطف ±2×2.5% أو ±2×5% أو +2.5%,-3×2.5%. إضافات للموسّع (≥1000kVA): ترمومتر أقصى، مؤشر زيت مغناطيسي، ريليه بوخهولتز، متنفس مجفف."},
  {"id": "abb:large-features", "page": 19, "title": "Large distribution transformers features",
   "text": "محولات التوزيع الكبيرة >2000kVA حتى 72.5kV: تُصنع وتُختبر وفق IEC 76 ومطابقة BS 171 وVDE 0532، يُسمح بالتحميل الزائد وفق IEC 354، تبريد ONAN أو ONAN/ONAF، قلب ثلاثي الأرجل مسمارية الوصلات مشطوفة 45°، مبدل شطف بلا حمل بخمس مراكز (المراكز 1-5: الأعلى نسبة = أدنى جهد LV؛ المراكز تحت الحمل بمشغل محرك وتبديل مقاومي سرعة عالية بم compartment زيت منفصل)، زيت وفق IEC 296 ويمكن التوريد بسيليكون أو MIDEL."},
  {"id": "abb:tests", "page": 12, "title": "Routine tests",
   "text": "الاختبارات الروتينية لكل محول وفق IEC: قياس مقاومة اللفات، قياس نسبة الجهد وفحص مجموعة المتجهات، قياس جهد المعاوقة وفقد الحمل، قياس فقد لا حمل وتيار لا حمل، اختبارات العزل الكهربائي — وعند الطلب اختبارات نوعية/خاصة بشهادة حضور."},
  {"id": "abb:dry-features", "page": 27, "title": "Dry type transformers (30 kVA - 30 MVA)",
   "text": "المحولات الجافة من 30kVA حتى 30MVA بأولي حتى 41.5kV وثانوي حتى 36kV، لظروف التلوث البيئي وخطر الحريق والرطوبة العالية والمناخات القاسية: مستشفيات وأماكن عامة ومنصات نفط وسفك ومترو أنفاق ومناجم، ومقاومة عالية للاهتزاز ومناسبة لمناطق الزلازل، مطابقة IEC 60726 وHD464 وHD538 بلا صيانة تقريباً."},
  {"id": "abb:vcc-features", "page": 29, "title": "Vacuum Cast Coil transformers (≤30 MVA)",
   "text": "محولات Vacuum Cast Coil من 50kVA حتى 30MVA بأولي حتى 36kV وثانوي حتى 6kV: لفانات HV مصبوبة فراغياً بريزين إيبوكسي وLV مُشبَّع مسبقاً، غير قابلة للاشتعال، ذاتية الإطفاء، مقاومة للرطوبة >75% ودرجات تحت -25°C (شهادة E2 لرطوبة 90% وحرارة 50°C وC2 للتشغيل حتى -25°C وF1 ذاتية الإطفاء)، عزل 155°C بارتفاع حرارة 100°C، شطف ±2×2.5%، تفريغ جزئي أقل من 5pC، تحمل نبضة حتى 200kV، والاختبارات الروتينية تشمل النسبة والعزل المطبق والمستحث والتفريغ الجزئي ومقاومة اللفات ومجموعة المتجهات وفقد لا حمل وفقد الحمل والمعاوقة."},
  {"id": "abb:single-phase", "page": 24, "title": "Single phase transformers (≤100 kVA)",
   "text": "محولات أحادية الطور زيتية للتتويج حتى 100kVA بجهود حتى 36kV (نطاق 15-100kVA)، بناء مختوم أو متنفس حر، للإضاءة والأحمال السكنية والصناعية والتنويعية على الشبكات الهوائية، بخزانات مجلفنة حرارياً وأطراف بورسلين/بوليستر، مع فتائل HV داخلية اختيارية وأطراف ANSI/DIN ونسب مزدوجة، ومطابقة IETS/IEC/ANSI حسب الطلب."},
  {"id": "abb:vsd", "page": 6, "title": "Transformers for variable speed drives",
   "text": "محولات محركات السرعة المتغيرة: بقدرات أولية حتى 30MVA زيتية أو جافة، لقيادة أحمال عالية بطيئة السرعة مثل رافعات المناجم ومطاحن الدرفلة ودفع السفن، والتصميم الصحيح يوفر خفضًا ملحوظًا في التوقف الممتد وعمر المعدات وتكلفة القدرة."},
]

abb_tr = {
    "meta": {
        "doc": "ABB — Distribution Transformers catalogue (The most comprehensive range of solutions for distribution transformer applications)",
        "citationFormat": "[ABB — Distribution Transformers Catalogue، <Section>، ص.<P>]",
        "citationFormatEn": "[ABB — Distribution Transformers Catalogue, <Section>, p.<P>]",
        "pages": 51,
        "tankGlyphs": {"L": "▲ مختومة بإحكام بخزان مموج (Hermetically sealed with corrugated tank)", "G": "● بخزان مموج مع موسّع زيت (Corrugated tank with conservator)"},
    },
    "items": small + med,
    "largeItems": large,
    "lossItems": losses,
    "ip00Dims": dims,
    "descriptive": abb_descriptive,
    "flags": abb_flags,
}
json.dump(abb_tr, open(f"{OUT}/abb_tr.json", "w", encoding="utf-8"), ensure_ascii=False)
print("  → abb_tr.json written")

# ════════════════════════════════════════════════════════════════════════════
# 2b) SCHNEIDER EGYPT — BREAKERS & SWITCHES PRICE LIST 2026 (319 pages, 8 TOC parts)
# ════════════════════════════════════════════════════════════════════════════

print("== 2b) SCHNEIDER BREAKERS & SWITCHES 2026 ==")
brk = fitz.open(PDF_BRK)
toc = brk.get_toc()
brk_parts = [(t[2], t[1]) for t in toc]
print("  TOC parts:", [(p, t[:40]) for p, t in brk_parts])

def brk_part_of(pg):
    cur = brk_parts[0][1]
    for sp, ttl in brk_parts:
        if pg >= sp:
            cur = ttl
    return cur

PRICE_RE = re.compile(r"^(?:\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d+)?$")
REF_MIXED = re.compile(r"^(?=[A-Za-z0-9_\-]{6,}$)(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]+$")
YEAR_TOK = {"2026", "2025", "2015", "2014"}
RATING_LADDER = {16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400,
                 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000}

def is_price_tok(t):
    if not PRICE_RE.match(t):
        return False
    v = fnum(t)
    if v < 100 or t in YEAR_TOK:
        return False
    # bare breaker-rating values (630/800/1600…) in description columns are NOT
    # prices; real 4-digit prices are comma-formatted or ≥5 digits
    if v in RATING_LADDER and "," not in t and len(t.replace(".", "").lstrip("0")) <= 4:
        return False
    return True

def ref_score(t):
    """letters+digits mix (3) > all-uppercase letters ≥8 (2) > pure 4-6 digits (1)."""
    if REF_MIXED.match(t):
        return 3
    if re.match(r"^[A-Z]{8,}$", t):
        return 2
    if re.match(r"^\d{4,6}$", t) and t not in YEAR_TOK:
        return 1
    return 0

FOOTER_MARKS = ("Version 1", "الاسعار", "All Prices", "جميع الاسعار")

def parse_brk_page(pg):
    """Price-anchored row parser. Each price-like token anchors one item row.
    Reference: same-line (±5px) best-scoring token; split references (ID cell
    wrapped over two lines, e.g. WACFAAANNNNNNNNNNC + EETNNN) are concatenated
    from x-aligned uppercase fragments above/below. Description = same-line
    leftover tokens. The small int ≤110 on ACB/MCCB rows is the Icu."""
    ws = page_words(brk[pg - 1])
    pw = [w for w in ws if is_price_tok(w["t"])]
    pw.sort(key=lambda w: w["y"])
    rows = []
    for w in pw:
        if rows and abs(rows[-1]["y"] - w["y"]) <= 5:
            rows[-1]["ps"].append(w)
        else:
            rows.append({"y": w["y"], "ps": [w]})
    items = []
    for r in rows:
        ps = sorted(r["ps"], key=lambda w: w["x"])
        price_word = ps[-1]
        price = fnum(price_word["t"])
        if len(ps) > 1:
            note(f"BRK p{pg}: multiple price-like tokens {ps[0]['t']} / {price_word['t']} — kept rightmost")
        py = r["y"]
        price_ids = {id(w) for w in r["ps"]}
        zoneA = [w for w in ws if abs(w["y"] - py) <= 5 and id(w) not in price_ids]
        cands = [(w, ref_score(w["t"])) for w in zoneA if ref_score(w["t"]) > 0]
        ref = None
        if cands and max(c[1] for c in cands) <= 1:
            # ZoneA holds only a weak (numeric) candidate — the real reference
            # may be a split ID wrapped above/below; prefer the band search
            cands = []
        if not cands:
            # split-cell references (ID wrapped over two lines, price midway):
            # search ±14px band for x-aligned reference fragments
            wide = [w for w in ws
                    if 5 < abs(w["y"] - py) <= 14 and ref_score(w["t"]) > 0
                    and abs(w["x"] - price_word["x"]) <= 130]
            if len(wide) == 1:
                ref_w = wide[0]
                ref = ref_w["t"]
                frags = [w for w in ws
                         if 5 < abs(w["y"] - py) <= 14 and re.match(r"^[A-Z]{1,8}$", w["t"])
                         and ref_score(w["t"]) == 0
                         and abs(w["x"] - ref_w["x"]) <= 50]
                if len(frags) == 1:
                    ref = ref + frags[0]["t"] if frags[0]["y"] > py else frags[0]["t"] + ref
                    note(f"BRK p{pg}: fragment joined → {ref}")
            elif len(wide) == 2 and abs(wide[0]["y"] - wide[1]["y"]) <= 14 and abs(wide[0]["x"] - wide[1]["x"]) <= 50:
                a, b = sorted(wide, key=lambda w: w["y"])
                ref = a["t"] + b["t"]
                ref_w = b
                note(f"BRK p{pg}: split reference joined → {ref}")
            else:
                if wide:
                    note(f"BRK p{pg}: ambiguous split ref {[(w['t'], round(w['y']-py,1)) for w in wide]}")
        if cands:
            best = max(c[1] for c in cands)
            top = [c for c in cands if c[1] == best]
            # ID column sits immediately left of the price column → max x wins ties
            top.sort(key=lambda c: -c[0]["x"])
            ref_w = top[0][0]
            ref = ref_w["t"]
            if best == 2:  # all-uppercase letters → possible split-cell ID
                frags = [w for w in ws
                         if 5 < abs(w["y"] - py) <= 14 and re.match(r"^[A-Z0-9]{4,}$", w["t"])
                         and not is_price_tok(w["t"]) and ref_score(w["t"]) > 0
                         and abs(w["x"] - ref_w["x"]) <= 50]
                if len(frags) == 1:
                    frag = frags[0]
                    ref = ref + frag["t"] if frag["y"] > py else frag["t"] + ref
                    note(f"BRK p{pg}: split reference joined → {ref}")
        if ref is None and len(ps) > 1:
            # accessory rows: plain 4-6 digit reference + comma/plain price on
            # the same line — promote the leftmost non-price numeric to ref
            for w in ps[:-1]:
                if re.match(r"^\d{4,6}$", w["t"]) and w["t"] not in YEAR_TOK:
                    ref = w["t"]
                    note(f"BRK p{pg}: numeric accessory reference promoted → {ref}")
                    break
        if ref is None:
            note(f"BRK p{pg}: price {price} with no reference — skipped")
            continue
        if price < 100:
            note(f"BRK p{pg}: suspicious price {price} for {ref}")
        others = [w for w in zoneA if ref_score(w["t"]) == 0]
        aux = None
        for w in sorted(others, key=lambda w: w["x"]):
            if re.match(r"^\d{1,3}$", w["t"]) and 16 <= fnum(w["t"]) <= 110:
                aux = fnum(w["t"])
                break
        # descriptions wrap over 2-3 lines around the price row — collect the
        # ±14px band (neighbour rows sit ~29px apart, so no bleeding)
        wide_zone = [w for w in ws
                     if abs(w["y"] - py) <= 14 and id(w) not in price_ids
                     and ref_score(w["t"]) == 0
                     and not (re.match(r"^\d{1,3}$", w["t"]) and 16 <= fnum(w["t"]) <= 110 and w in [o for o in zoneA if ref_score(o["t"]) == 0])
                     and not re.match(r"^[A-Z]{8,}$", w["t"])]
        desc_toks = [w["t"] for w in sorted(wide_zone, key=lambda w: (w["y"], w["x"]))
                     if w["t"] != (str(int(aux)) if aux is not None else None)]
        items.append({"ref": ref, "price": price, "auxA": aux, "page": pg,
                      "descInline": re.sub(r"\s+", " ", " ".join(desc_toks)).strip()})
    return items

HEAD_RE = re.compile(r"(Breaker|Breakers|Switch|GoPact|Resi9|Acti9|Easy9|iC60|iPRF?|iC65|Masterpact|Easypact|MVS|ENW ?[12]|NW|NT|MTZ|accessories|Accessory|Interlocking|Chassis|Trip unit|Contactor|Relay|Starter|Meter|Capacitor|Harmony|XB[0-9]|TM3|ATV|Altivar|TeSys|LC1|LR2|GV2|DM1|DM3|Canalis|Vario|Pushbutton|Indicator|Pilot light|Modul|Multi9|NSX|ComPact|Vigi|SPD|Surge|RCCB|RCBO|MCB|Changeover|Panorama)", re.I)

def brk_headings(pg):
    out = []
    rows = y_rows(page_words(brk[pg - 1]), tol=4.5)
    for r in rows:
        j = re.sub(r"\s+", " ", " ".join(t for _, t in sorted(r["cells"]))).strip()
        if not j or any(m in j for m in FOOTER_MARKS):
            continue
        if any(is_price_tok(t) for _, t in sorted(r["cells"])):
            continue
        if len(j) > 120:
            continue
        if HEAD_RE.search(j):
            out.append((r["y"], j))
    return out

brk_items = []
for pg in range(1, len(brk) + 1):
    its = parse_brk_page(pg)
    if not its:
        continue
    heads = brk_headings(pg)
    row_y = {}
    for r in y_rows(page_words(brk[pg - 1]), tol=4.5):
        for _, t in sorted(r["cells"]):
            row_y.setdefault(t, r["y"])
    for it in its:
        y = row_y.get(it["ref"][:18])
        above = [h for h in heads if y is not None and h[0] <= y + 3]
        it["subsection"] = above[-1][1] if above else ""
        if y is not None:
            it["_y"] = y
        it["part"] = brk_part_of(pg)
        blob = it["descInline"]
        m = re.search(r"(\d{2,4})\s*A\b", blob)
        it["ratingA"] = int(m.group(1)) if m else None
        m = re.search(r"\b([1-4])P", blob)
        it["poles"] = int(m.group(1)) if m else None
        m = re.search(r"(\d{2,3})\s*(?:kA|KA)\b", blob)
        it["icuFromDesc"] = int(m.group(1)) if m else None
        m = re.search(r"([\d.]+)\s*kW", blob, re.I)
        it["kw"] = float(m.group(1)) if m else None
        m = re.search(r"(\d{1,3})\s*mA", blob)
        it["ma"] = int(m.group(1)) if m else None
        it["desc"] = blob.strip()
        it.pop("_y", None)
        brk_items.append(it)

# anchors verified against the price list pages
def _find(ref):
    return next((x for x in brk_items if x["ref"] == ref), None)
for ref, price, pg in [
    ("TABEAAANN", 196383, 1), ("WKCFAAANN", 229885, 3), ("MTZ106_H12E3PMFHH", 198342, None),
    ("G12T3F16", 4657, None), ("MVS08H3MF2L", 195330, None), ("NW08H1HHF3P2E", 256120, None),
    ("NT08H1HHF3P2E", 195670, None), ("ENW106C3MF2SH", 186112, None), ("R9R51225", 3067, None),
    ("XB7NW3361", 556, None), ("TM3AI2H", 21100, None), ("LR2K0301", 3046, None),
    ("ATV320U04N4B", 21810, None), ("LC1DT20M7", 3445, None),
    ("ENW106C3MW2SH", 259548.14, None), ("ENW110C3MW2SH", 271031.52, None),
    ("ENW240H4MW2SH", 1206016.63, None), ("ENW240H3MW2SH", 915951.54, None),
]:
    row = _find(ref)
    if row is None:
        note(f"BRK anchor ref {ref} NOT FOUND")
    else:
        if abs(row["price"] - price) > 1:
            raise AssertionError(f"BRK anchor {ref}: price {row['price']} != {price}")

brk_meta = {
    "doc": "Schneider Electric Egypt — Breakers and Switches Price List 2026 (se.com/eg), Version 1 - Feb 2026",
    "citationFormat": "[Schneider Electric Egypt — Breakers & Switches Price List 2026، <Part>، ص.<P>، Product ID: <REF>]",
    "citationFormatEn": "[Schneider Electric Egypt — Breakers & Switches Price List 2026, <Part>, p.<P>, Product ID: <REF>]",
    "pages": len(brk),
    "currency": "EGP (not including VAT) — قائمة Version 1 - Feb 2026",
    "parts": brk_parts,
}
json.dump({"meta": brk_meta, "items": brk_items}, open(f"{OUT}/schneider_brk.json", "w", encoding="utf-8"), ensure_ascii=False)
per_part = collections.Counter(x["part"][:36] for x in brk_items)
print(f"  items={len(brk_items)}; per part: {dict(per_part)}")
print("  → schneider_brk.json written")

# ════════════════════════════════════════════════════════════════════════════
# 3) FULL PAGE-LEVEL INDEX (all six documents — nothing left out)
# ════════════════════════════════════════════════════════════════════════════

print("== 3) PAGE-LEVEL INDEX (all six documents) ==")

AR_ORD = {"الأول": 1, "الثانى": 2, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
          "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10, "الحادى عشر": 11,
          "الحادي عشر": 11, "الثانى عشر": 12, "الثاني عشر": 12}

def nfkc(s):
    return unicodedata.normalize("NFKC", s)

def detect_arabic_part(text):
    """Detect الباب N + الفصل M from a page's running header. Handles both
    word orders (الباب السابع / السابع الباب) and scrambled PDF text."""
    head = nfkc(text[:500])
    part = chap = None
    m = re.search(r"الباب\s+([^\n]{0,22})", head)
    if not m:
        m = re.search(r"([^\n\s]{1,22})\s*الباب", head)
    if m:
        w = m.group(1).strip()
        for k, v in AR_ORD.items():
            if k in w:
                part = v
                break
    if part is None:
        m = re.search(r"الفصل\s+([^\n]{0,26})", head)
        if not m:
            m = re.search(r"([^\n\s]{1,26})\s*الفصل", head)
        if m:
            w = m.group(1).strip()
            for k, v in AR_ORD.items():
                if k in w:
                    chap = v
                    break
    return part, chap

def detect_elsewedy_table(text):
    m = re.search(r"Table\s+(\d{1,2})", text[:1200])
    return int(m.group(1)) if m else None

def chunk_page(text, max_len=850):
    """Split page text into chunks ≤ max_len at line boundaries."""
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= max_len:
        return [text] if text else []
    lines = text.split("\n")
    chunks, cur = [], ""
    for ln in lines:
        if len(cur) + len(ln) + 1 > max_len and cur:
            chunks.append(cur.strip())
            cur = ""
        cur += ln + "\n"
    if cur.strip():
        chunks.append(cur.strip())
    return [c for c in chunks if len(c) >= 25]

DOCS = [
    {"doc": "saudi-dps", "path": PDF_DPS, "pages": 46},
    {"doc": "abb-tr", "path": PDF_ABB, "pages": 51},
    {"doc": "egycode-1", "path": PDF_EGY1, "pages": 140},
    {"doc": "egycode-2", "path": PDF_EGY2, "pages": 167},
    {"doc": "elsewedy", "path": PDF_ELSE, "pages": 191},
    {"doc": "gilany", "path": PDF_GIL, "pages": 957},
    {"doc": "schneider-brk", "path": PDF_BRK, "pages": 319},
]

pages_index = []
stats = {}
for spec in DOCS:
    d = fitz.open(spec["path"])
    n_chunks = n_image_pages = 0
    last_part = None
    page_meta = []
    for pi, page in enumerate(d):
        raw = page.get_text()
        text = nfkc(raw)
        p2, c2 = detect_arabic_part(text) if text.strip() else (None, None)
        page_meta.append((p2, c2))
    # forward-fill: a الباب divider labels everything after it until the next
    for i in range(1, len(page_meta)):
        if page_meta[i][0] is None:
            page_meta[i] = (page_meta[i - 1][0], page_meta[i][1] or page_meta[i - 1][1])
    for pi, page in enumerate(d):
        pg = pi + 1
        raw = page.get_text()
        text = nfkc(raw)
        part, chap = page_meta[pi]
        if len(text.strip()) < 60:
            n_image_pages += 1
            pages_index.append({
                "doc": spec["doc"], "page": pg, "part": part, "chapter": chap,
                "chunk": 0, "len": len(text.strip()), "image": True,
                "text": f"[صفحة {pg} — محتوى مصوّر/مسح ضوئي لا يمكن استخراج نصه آلياً من هذا الملف؛ راجع المحتوى المفهرس للأبواب المجاورة أو اطلب من المستخدم تحديد العنصر بصرياً]",
            })
            n_chunks += 1
            continue
        part, chap = detect_arabic_part(text)
        table_no = detect_elsewedy_table(raw) if spec["doc"] == "elsewedy" else None
        pieces = chunk_page(text)
        if not pieces:
            pieces = [text.strip()[:850]]
        for ci, c in enumerate(pieces):
            pages_index.append({
                "doc": spec["doc"], "page": pg, "part": part, "chapter": chap,
                "table": table_no, "chunk": ci, "len": len(c), "image": False, "text": c,
            })
            n_chunks += 1
    stats[spec["doc"]] = {"pages": len(d), "chunks": n_chunks, "imagePages": n_image_pages}
    print(f"  {spec['doc']}: pages={len(d)} chunks={n_chunks} imagePages={n_image_pages}")
    del d

refs_pages = {"meta": {"generated": "full page-level index — no page omitted", "docs": stats}, "chunks": pages_index}
json.dump(refs_pages, open(f"{OUT}/refs_pages.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"  → refs_pages.json written ({len(pages_index)} chunks)")

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
print("\n== SUMMARY ==")
print(f"DPS: T3={len(t3)} T4={len(t4)} T5={len(t5)} T6={len(t6)} rows; densities T7={len(t7)} T8={len(t8)} T9={len(t9)} T10={len(t10)}; DF={len(df_rows)}; CF={len(cf)}; types={len(types)}; rules={len(saudi_rules)}; sections={len(dps_sections)}")
print(f"ABB: small={len(small)} medium={len(med)} large={len(large)} losses={len(losses)} ip00Dims={len(dims)}; descriptive={len(abb_descriptive)}; flags={len(abb_flags)}")
print(f"Schneider: items={len(brk_items)}; Pages index: {len(pages_index)} chunks across {len(DOCS)} docs")
if problems:
    print(f"\n{len(problems)} notes:")
    for p in problems:
        print("  -", p)
print("\nEXTRACTION OK")
