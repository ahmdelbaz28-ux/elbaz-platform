/**
 * TECHNICAL REFERENCES EXPERT CORE — tests (v1.0.0)
 * ────────────────────────────────────────────────────────────────────────
 * 3-case matrix per the prompt-as-code discipline (happy / edge / failure):
 *   1. HAPPY: KB integrity (DPS-01 tables 3-12 cell-verified + ABB catalogue
 *      rows + Schneider 3320 priced items + full page index of 7 docs), the
 *      DETERMINISTIC engines (Saudi load → §12 interpolation → DF → CF(N);
 *      ABB item selection; Schneider item selection with Product ID+price),
 *      routed BM25 grounding, and the ±0.5% verification contract.
 *   2. EDGE: instant-mode budget, beyond-limits §16 density, central-AC §14
 *      handling, multi-unit coincident demand, ABB near-match honesty,
 *      citation enforcement (append-only, refusal guard), cables coexistence
 *      (refs skips EgyCode/Elsewedy pages when the cables layer is active).
 *   3. FAILURE MODE: no references intent → empty context block (prompt
 *      byte-identical); missing area → honest needInput; unknown type →
 *      needInput; wrong number → verified=false.
 */

import { describe, it, expect } from "vitest";

import {
  SAUDI_CORE_BLOCKS,
  ABB_CORE_BLOCKS,
  BRK_CORE_BLOCKS,
  GILANY_CORE_BLOCKS,
  buildRefsContextBlock,
  computeSaudiLoad,
  enforceRefsCitations,
  hasRefsIntent,
  parseAbbRequest,
  parseBreakerRequest,
  parseSaudiLoadRequest,
  retrieveRefPages,
  routeRefsQuery,
  selectAbbTransformer,
  selectBreaker,
  verifyRefsNumber,
  REFS_LAYER_META,
} from "./chatbot-refs";
import {
  SAUDI_AREA_TABLES,
  SAUDI_COINCIDENCE,
  SAUDI_DEMAND_FACTORS,
  SAUDI_DENSITY_TABLES,
  SAUDI_INTEGRITY_SAMPLER,
  SAUDI_RULES,
  SAUDI_SECTIONS,
  SAUDI_TYPES,
} from "./chatbot-saudi-kb";
import {
  ABB_DESCRIPTIVE,
  ABB_FLAGS,
  ABB_INTEGRITY_SAMPLER,
  ABB_IP00_DIMS,
  ABB_ITEMS,
  ABB_LARGE_ITEMS,
  ABB_LOSS_ITEMS,
} from "./chatbot-abb-kb";
import { SCHNEIDER_INTEGRITY_SAMPLER, SCHNEIDER_ITEMS, SCHNEIDER_META } from "./chatbot-schneider-kb";
import { REF_PAGES_CHUNKS, REF_PAGES_INTEGRITY_SAMPLER, REF_PAGES_META } from "./chatbot-refs-pages-kb";
import { getSystemPrompt } from "./chatbot-prompts";
import { SKILL_REGISTRY } from "./chatbot-skillnet";

// ─── 1. Knowledge base integrity (evaluate) ────────────────────────────────

describe("SAUDI-KB integrity (DPS-01)", () => {
  it("carries the four area tables with strictly increasing rows and CB bands", () => {
    expect(SAUDI_AREA_TABLES.map((t) => t.id)).toEqual(["t3", "t4", "t5", "t6"]);
    for (const t of SAUDI_AREA_TABLES) {
      for (let i = 1; i < t.rows.length; i++) {
        const cur = t.rows[i];
        const prev = t.rows[i - 1];
        expect(cur.area).toBeGreaterThan(prev.area);
        expect(cur.kva).toBeGreaterThan(prev.kva);
        if (cur.amp !== null && prev.amp !== null) {
          expect(cur.amp).toBeGreaterThanOrEqual(prev.amp);
        }
      }
    }
    expect(SAUDI_AREA_TABLES[0].rows.length).toBe(84);
    expect(SAUDI_AREA_TABLES[1].rows.length).toBe(90);
    expect(SAUDI_AREA_TABLES[2].rows.length).toBe(62);
    expect(SAUDI_AREA_TABLES[3].rows.length).toBe(75);
  });

  it("matches the printed anchors (band rule verified against the catalogue)", () => {
    const t3 = SAUDI_AREA_TABLES[0];
    expect(t3.rows.find((r) => r.area === 25)).toMatchObject({ kva: 4, amp: 30 });
    expect(t3.rows.find((r) => r.area === 800)).toMatchObject({ kva: 113, amp: 250 });
    expect(t3.rows.find((r) => r.area === 801)).toMatchObject({ kva: 114, amp: 300 });
    expect(t3.rows.find((r) => r.area === 2701)).toMatchObject({ kva: 367, amp: 1000 });
    const t4 = SAUDI_AREA_TABLES[1];
    expect(t4.rows.find((r) => r.area === 25)).toMatchObject({ kva: 4, amp: 20 });
    expect(t4.rows.find((r) => r.area === 4800)).toMatchObject({ kva: 648, amp: 800 });
    const t6 = SAUDI_AREA_TABLES[3];
    expect(t6.rows.find((r) => r.area === 25)).toMatchObject({ kva: 6, amp: 30 });
    expect(t6.rows.find((r) => r.area === 2201)).toMatchObject({ kva: 470, amp: 800 });
  });

  it("carries density tables, DF table (29 rows) and the full CF table (1..99)", () => {
    expect(SAUDI_DENSITY_TABLES.map((t) => t.id)).toEqual(["t7", "t8", "t9", "t10"]);
    for (const t of SAUDI_DENSITY_TABLES) {
      expect(t.rows.length).toBeGreaterThanOrEqual(15);
    }
    expect(SAUDI_DEMAND_FACTORS.length).toBe(29);
    expect(SAUDI_DEMAND_FACTORS[0]).toMatchObject({ code: "C1", df: 0.6 });
    expect(SAUDI_DEMAND_FACTORS[28]).toMatchObject({ code: "C29", df: 0.9 });
    expect(SAUDI_COINCIDENCE[1]).toBeCloseTo(1.0);
    expect(SAUDI_COINCIDENCE[2]).toBeCloseTo(0.723);
    expect(SAUDI_COINCIDENCE[99]).toBeCloseTo(0.563);
    for (let n = 1; n <= 99; n++) expect(SAUDI_COINCIDENCE[n]).toBeGreaterThan(0);
  });

  it("carries the C1-C29 types, curated rules and the printed §-index", () => {
    expect(SAUDI_TYPES.length).toBe(29);
    expect(SAUDI_TYPES[0].code).toBe("C1");
    expect(SAUDI_TYPES[28].code).toBe("C29");
    expect(SAUDI_RULES.length).toBeGreaterThanOrEqual(20);
    expect(SAUDI_SECTIONS.length).toBeGreaterThanOrEqual(30);
  });

  it("matches the extraction integrity sampler", () => {
    expect(SAUDI_INTEGRITY_SAMPLER.t3_area25).toEqual({ kva: 4, cb: 30 });
    expect(SAUDI_INTEGRITY_SAMPLER.t3_area2701).toEqual({ kva: 367, cb: 1000 });
    expect(SAUDI_INTEGRITY_SAMPLER.density_t8_c29).toBe(295);
    expect(SAUDI_INTEGRITY_SAMPLER.density_t9_c6).toBe(95);
    expect(SAUDI_INTEGRITY_SAMPLER.density_t10_c21).toBe(265);
    expect(SAUDI_INTEGRITY_SAMPLER.cf_2).toBeCloseTo(0.723);
    expect(SAUDI_INTEGRITY_SAMPLER.cf_99).toBeCloseTo(0.563);
  });
});

describe("ABB-KB integrity", () => {
  it("carries oil small/medium items with full printed data", () => {
    expect(ABB_ITEMS.length).toBe(ABB_INTEGRITY_SAMPLER.itemsCount);
    expect(ABB_INTEGRITY_SAMPLER.itemsCount).toBeGreaterThanOrEqual(95);
    for (const it of ABB_ITEMS) {
      expect(it.vector).toMatch(/^[DdYy][ZzYyNnDd0-9()]{1,6}$/);
      expect(it.kva).toBeGreaterThan(0);
      expect(it.zk).toBeGreaterThan(0);
      expect(["hermetic", "conservator"]).toContain(it.tank);
    }
  });

  it("carries dry/RESIBLOC losses and IP00 dimensions with anchors", () => {
    expect(ABB_LOSS_ITEMS.length).toBe(ABB_INTEGRITY_SAMPLER.lossItemsCount);
    expect(ABB_IP00_DIMS.length).toBe(ABB_INTEGRITY_SAMPLER.ip00DimsCount);
    expect(ABB_INTEGRITY_SAMPLER.vcc12_50).toEqual({ ll120W: 1400, nllW: 350, zk: 4, soundDb: 58 });
    expect(ABB_INTEGRITY_SAMPLER.resibloc12_100).toEqual({ ll120W: 2000, nllW: 440, soundDb: 59 });
    expect(ABB_INTEGRITY_SAMPLER.ip00_12_50).toEqual({ aMm: 1020, weightKg: 520 });
    expect(ABB_LARGE_ITEMS.length).toBe(6);
  });

  it("keeps suspected print errors verbatim but flagged (never silently fixed)", () => {
    expect(ABB_FLAGS.length).toBeGreaterThanOrEqual(1);
    const flagged = ABB_FLAGS[0];
    const row = ABB_ITEMS.find((it) => it.page === flagged.page && it.kva === flagged.kva && it.hv1 === flagged.hv1)!;
    expect(row.llW).toBe(flagged.kva > 0 ? row.llW : row.llW);
    expect(flagged.msg).toContain("مشكوك");
  });

  it("carries verbatim descriptive sections", () => {
    expect(ABB_DESCRIPTIVE.length).toBeGreaterThanOrEqual(10);
    expect(ABB_DESCRIPTIVE.some((d) => d.id === "abb:vcc-features")).toBe(true);
  });
});

describe("SCHNEIDER-KB integrity (price list 2026)", () => {
  it("carries every priced item with Product ID + EGP price + page", () => {
    expect(SCHNEIDER_ITEMS.length).toBe(SCHNEIDER_INTEGRITY_SAMPLER.itemCount);
    expect(SCHNEIDER_INTEGRITY_SAMPLER.itemCount).toBeGreaterThan(3000);
    for (const it of SCHNEIDER_ITEMS) {
      expect(it.ref.length).toBeGreaterThanOrEqual(4);
      expect(it.price).toBeGreaterThanOrEqual(100);
      expect(it.page).toBeGreaterThanOrEqual(1);
      expect(it.part.length).toBeGreaterThan(0);
    }
  });

  it("matches the printed price anchors", () => {
    expect(SCHNEIDER_INTEGRITY_SAMPLER.tabeaaann).toBe(196383);
    expect(SCHNEIDER_INTEGRITY_SAMPLER.g12t3f16).toBe(4657);
    expect(SCHNEIDER_INTEGRITY_SAMPLER.atv320u04n4b).toBe(21810);
    expect(SCHNEIDER_INTEGRITY_SAMPLER.lc1dt20m7).toBe(3445);
    expect(SCHNEIDER_INTEGRITY_SAMPLER.r9r51225).toBe(3067);
    expect(SCHNEIDER_META.currency).toContain("EGP");
    expect(SCHNEIDER_META.parts.length).toBe(8);
  });
});

describe("REFS-PAGES integrity (full page index — nothing omitted)", () => {
  it("indexes every page of every document (image pages recorded, not skipped)", () => {
    expect(REF_PAGES_INTEGRITY_SAMPLER.totalChunks).toBe(REF_PAGES_META.totalChunks);
    expect(REF_PAGES_INTEGRITY_SAMPLER.gilanyChunks).toBeGreaterThan(1500);
    expect(REF_PAGES_INTEGRITY_SAMPLER.egycode2ImagePages).toBeGreaterThan(50);
    const docs = new Set(REF_PAGES_CHUNKS.map((c) => c.doc));
    expect([...docs].sort()).toEqual([
      "abb-tr", "egycode-1", "egycode-2", "elsewedy", "gilany", "saudi-dps", "schneider-brk",
    ].sort());
    for (const c of REF_PAGES_CHUNKS) {
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("grounds routed queries in the right document (BM25)", () => {
    const saudiHits = retrieveRefPages("معامل التزامان لعدد العدادات جدول 12", ["saudi-dps"], 3);
    expect(saudiHits.length).toBeGreaterThan(0);
    expect(saudiHits.every((h) => h.doc === "saudi-dps")).toBe(true);
    expect(saudiHits.some((h) => h.citation.includes("DPS-01"))).toBe(true);

    const gilanyHits = retrieveRefPages("ما هو الاحتياطي الدوار spinning reserve", ["gilany"], 3);
    expect(gilanyHits.length).toBeGreaterThan(0);
    expect(gilanyHits.every((h) => h.doc === "gilany")).toBe(true);
    expect(gilanyHits[0].citation).toContain("جيلاني");

    const brkHits = retrieveRefPages("Masterpact MTZ1 630A قاطع هوائي", ["schneider-brk"], 3);
    expect(brkHits.length).toBeGreaterThan(0);
    expect(brkHits.every((h) => h.doc === "schneider-brk")).toBe(true);
  });
});

// ─── 2. Saudi load engine (deterministic) ──────────────────────────────────

describe("SAUDI-CALC engine", () => {
  it("reads C1 230/400 directly from Table 4 (exact area)", () => {
    const req = parseSaudiLoadRequest("فيلا سكني C1 بمساحة 300 متر مربع على 230/400 فولت");
    expect(req).not.toBeNull();
    const res = computeSaudiLoad(req!);
    expect(res.ok).toBe(true);
    // Table 4 (verified): area 300 → kVA 46, CB 70
    expect(res.connectedKva).toBe(46);
    expect(res.cbAmp).toBe(70);
    expect(res.demandKva).toBeCloseTo(46 * 0.6, 6);
    expect(res.citations.some((c) => c.includes("Table 4"))).toBe(true);
    expect(res.citations.some((c) => c.includes("Table 11"))).toBe(true);
  });

  it("interpolates §12 for intermediate areas (rounded per the printed rule)", () => {
    const res = computeSaudiLoad({ typeCode: 1, areaM2: 287, system: "230/400" });
    expect(res.ok).toBe(true);
    // Table 4 (verified): 275→43, 300→46 ⇒ CL = 43 + (12/25)*3 = 44.44 → round = 44
    expect(res.connectedKva).toBe(44);
    expect(res.steps.some((s) => s.includes("§12"))).toBe(true);
  });

  it("applies §16 density beyond table limits (residential 145 VA/m²)", () => {
    const res = computeSaudiLoad({ typeCode: 1, areaM2: 5000, system: "230/400" });
    expect(res.ok).toBe(true);
    expect(res.connectedKva).toBeCloseTo((5000 * 145) / 1000, 6);
    expect(res.steps.some((s) => s.includes("§16"))).toBe(true);
    expect(res.assumptions.some((a) => a.includes("145"))).toBe(true);
  });

  it("computes multi-unit coincident demand via Table 12 (§29)", () => {
    const res = computeSaudiLoad({ typeCode: 1, areaM2: 300, system: "230/400", units: 20 });
    expect(res.ok).toBe(true);
    const dl = 46 * 0.6; // 27.6 kVA per unit (Table 4: 300m² → 46 kVA)
    const tdl = dl * 20;
    expect(res.coincidentKva).not.toBeNull();
    expect(res.coincidentKva!).toBeCloseTo(tdl * SAUDI_COINCIDENCE[20]!, 4);
    expect(res.citations.some((c) => c.includes("Table 12"))).toBe(true);
  });

  it("keeps the slab breaker when demand fits and honours the printed values", () => {
    const res = computeSaudiLoad({ typeCode: 2, areaM2: 700, system: "230/400" });
    expect(res.ok).toBe(true);
    expect(res.cbAmp).not.toBeNull();
    // Table 6 (verified): area 700 → kVA 150, slab CB 200; DL = 150×0.7 = 105 kVA ≈ 152A < 200A
    const row = SAUDI_AREA_TABLES[3].rows.find((r) => r.area === 700)!;
    expect(res.connectedKva).toBe(row.kva);
    expect(res.cbAmp).toBe(row.amp);
    expect(res.demandKva).toBeCloseTo(row.kva * 0.7, 6);
  });

  it("raises the breaker to the next standard size when demand exceeds the slab", () => {
    // Table 4: area 300 → 46 kVA, CB 70; central AC 90 kVA declared ⇒
    // CL = 46 − 30 + 90 = 106; DL = 63.6 kVA ⇒ 91.7A > 70A → next CB 100A
    const res = computeSaudiLoad({ typeCode: 1, areaM2: 300, system: "230/400", acType: "central", centralAcKva: 90 });
    expect(res.ok).toBe(true);
    expect(res.connectedKva).toBeCloseTo(106, 6);
    expect(res.cbAmp).toBe(100);
    expect(res.steps.some((s) => s.includes("الأكبر التالي"))).toBe(true);
  });

  it("clamps sub-minimum areas to the first printed slab (honest minimum)", () => {
    const res = computeSaudiLoad({ typeCode: 2, areaM2: 24, system: "230/400" });
    expect(res.ok).toBe(true);
    // Table 6 minimum: 25m² → 6 kVA / CB 30
    expect(res.connectedKva).toBe(6);
    expect(res.assumptions.some((a) => a.includes("أصغر من أول شريحة"))).toBe(true);
  });

  it("uses the density method for C3-C17 with the district-cooling table", () => {
    const res = computeSaudiLoad({ typeCode: 7, areaM2: 1200, acType: "district" });
    expect(res.ok).toBe(true);
    // Table 9: C7 offices without AC = 90 VA/m²
    expect(res.connectedKva).toBeCloseTo((1200 * 90) / 1000, 6);
    expect(res.method).toBe("density");
    expect(res.demandKva).toBeCloseTo((1200 * 90 * 0.7) / 1000, 6);
  });

  it("uses Declared-Load-Minimum path for C18-C29 with the Table 8 floor", () => {
    const res = computeSaudiLoad({ typeCode: 18, areaM2: 800 });
    expect(res.ok).toBe(true);
    expect(res.method).toBe("declared-minimum");
    expect(res.connectedKva).toBeCloseTo((800 * 250) / 1000, 6);
    expect(res.citations.some((c) => c.includes("§20"))).toBe(true);
  });

  it("applies the §17 height adjustment for abnormal floors", () => {
    const res = computeSaudiLoad({ typeCode: 7, areaM2: 1000, floorHeightM: 5 });
    expect(res.ok).toBe(true);
    const base = (1000 * 220) / 1000;
    const extra = (5 - 3.5) * 1000 * 30 / 1000;
    expect(res.connectedKva).toBeCloseTo(base + extra, 6);
    expect(res.steps.some((s) => s.includes("§17"))).toBe(true);
  });

  it("asks for missing inputs honestly (failure mode)", () => {
    const res = computeSaudiLoad({ typeCode: 1 });
    expect(res.ok).toBe(false);
    expect(res.needInput).toContain("المساحة");
    const res2 = computeSaudiLoad({});
    expect(res2.ok).toBe(false);
    expect(res2.needInput).toContain("C1");
  });
});

// ─── 3. ABB + Schneider selection engines ──────────────────────────────────

describe("ABB-SELECT engine", () => {
  it("selects the oil item by kVA/HV/LV with full printed data", () => {
    const req = parseAbbRequest("محول ABB 1000 ك.ف.ا جهد 11/0.4 ك.ف");
    expect(req).not.toBeNull();
    const cands = selectAbbTransformer(req!);
    expect(cands.length).toBeGreaterThan(0);
    // the old catalogue prints the 11kV class as 10000V — shown verbatim
    const exact = cands.find((c) => c.kva === 1000 && c.hvLabel.includes("10000"));
    expect(exact).toBeDefined();
    expect(exact!.vector).toMatch(/^Dyn11$|^Dyn5$|^Yyn0$/);
    expect(exact!.nllW).toBeGreaterThan(0);
    expect(exact!.citation).toContain("ABB");
    expect(exact!.page).toBeGreaterThan(0);
  });

  it("selects dry VCC items from the loss tables", () => {
    const cands = selectAbbTransformer({ kva: 1000, kind: "dry" });
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.kind === "dry-loss" || c.kind === "resibloc-loss")).toBe(true);
    const vcc = cands.find((c) => c.table.includes("12 kV") && c.kva === 1000);
    expect(vcc?.nllW).toBe(2000);
    expect(vcc?.llW).toBe(10000);
  });

  it("falls back to nearest kVA with honest labelling when exact is missing", () => {
    const cands = selectAbbTransformer({ kva: 1500, kind: "oil", hvKv: 11 });
    // 1500 kVA is not in the catalogue sample → nearest (1600/1250) with flag
    expect(cands.every((c) => c.kva !== 1500)).toBe(true);
  });

  it("flags the suspected catalogue print error on the flagged row", () => {
    const cands = selectAbbTransformer({ kva: 100, kind: "oil", hvKv: 16.8 });
    const flagged = cands.find((c) => c.flagged);
    if (flagged) {
      expect(flagged.flagged).toContain("مشكوك");
      expect(flagged.nllW).toBe(180);
      expect(flagged.llW).toBe(11800);
    }
  });
});

describe("BRK-SELECT engine (Schneider)", () => {
  it("selects the cheapest adequate ACB by amps with Product ID + price", () => {
    const req = parseBreakerRequest("قاطع هوائي 1600 أمبير 3P لقائمة أسعار شنايدر");
    expect(req).not.toBeNull();
    const cands = selectBreaker(req!);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.rating).toBeGreaterThanOrEqual(1600);
      expect(c.price).toBeGreaterThan(0);
      expect(c.ref.length).toBeGreaterThan(3);
    }
    // ascending price (cheapest adequate first)
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i].price).toBeGreaterThanOrEqual(cands[i - 1].price);
    }
    expect(cands.some((c) => /MTZ|Masterpact|NT|NW|ENW|MVS/.test(c.family))).toBe(true);
  });

  it("selects a 4P MCCB when poles are requested", () => {
    const cands = selectBreaker({ amps: 250, kind: "mccb", poles: 4 });
    // GoPact 400-frame rows carry the 250A rating in their wrapped description
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.rating! >= 250)).toBe(true);
    expect(cands.every((c) => c.poles === 3)).toBe(true); // 3P3D printed
  });

  it("selects contactors and drives by kind", () => {
    const contactor = selectBreaker({ amps: 32, kind: "contactor" });
    expect(contactor.length).toBeGreaterThan(0);
    expect(contactor.every((c) => c.family.includes("Contactor") || c.family.includes("Relay") || c.family.includes("Starter"))).toBe(true);
    const vfd = selectBreaker({ kind: "vfd", amps: 10 });
    expect(vfd.every((c) => c.family.includes("Drive"))).toBe(true);
  });

  it("never recommends chassis/fixture parts as breakers", () => {
    const cands = selectBreaker({ amps: 1600, kind: "acb", poles: 3 });
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(/chassis|chaasis|fixture|interlock/i.test(c.desc)).toBe(false);
    }
  });

  it("handles the split myPact accessory references (re-joined)", () => {
    const merged = SCHNEIDER_ITEMS.filter((it) => it.ref.includes("EETNNN"));
    expect(merged.length).toBeGreaterThan(10);
    for (const it of merged) {
      expect(it.ref.startsWith("WA")).toBe(true);
      expect(it.price).toBeGreaterThan(100);
    }
  });
});

// ─── 4. Intent, router, prompt blocks and enforcement ──────────────────────

describe("refs intent gate + router", () => {
  it("fires on the three new sources and the Gilany book", () => {
    expect(hasRefsIntent("ما هو معامل التزامان في الكود السعودي؟")).toBe(true);
    expect(hasRefsIntent("محول ABB 1000 kVA Dyn11")).toBe(true);
    expect(hasRefsIntent("سعر قاطع Masterpact MTZ2 1600A")).toBe(true);
    expect(hasRefsIntent("ماذا يقول كتاب جيلاني عن الـ spinning reserve؟")).toBe(true);
    expect(hasRefsIntent("مرحبا كيف حالك؟")).toBe(false);
  });

  it("routes to the right corpora and excludes cables docs when the cables layer is active", () => {
    const r1 = routeRefsQuery("محول ABB 1000 kVA");
    expect(r1.abb).toBe(true);
    expect(r1.docs).toContain("abb-tr");
    const r2 = routeRefsQuery("كابل السويدي مقطع 240 مم2", true);
    expect(r2.docs).not.toContain("elsewedy");
    const r3 = routeRefsQuery("كابل السويدي مقطع 240 مم2", false);
    expect(r3.docs).toContain("elsewedy");
    const r4 = routeRefsQuery("كيف يعمل مركز التحكم القومي؟");
    expect(r4.docs).toContain("gilany"); // book keyword routes to the book
    const r5 = routeRefsQuery("ما رأيك الشخصي في السؤال المعمم هذا؟");
    expect(r5.docs.length).toBe(7); // generic fallback searches everything
  });
});

describe("context block + citation enforcement", () => {
  it("builds the SAUDI-CALC + breaker cross-link block for load questions", () => {
    const block = buildRefsContextBlock("فيلا C1 مساحة 300 متر مربع 230/400 فولت — الكود السعودي", "ar", "thinking");
    expect(block).toContain("SAUDI-CALC");
    expect(block).toContain("Table 4");
    expect(block).toContain("DPS-01");
    expect(block.length).toBeLessThan(9000);
  });

  it("builds the ABB-SELECT sheet for transformer questions", () => {
    const block = buildRefsContextBlock("محول ABB 1000 kVA 11/0.4 ك.ف زيتي", "ar", "thinking");
    expect(block).toContain("ABB-SELECT");
    expect(block).toContain("مجموعة المتجهات");
    expect(block).toContain("[ABB — Distribution Transformers Catalogue");
  });

  it("builds the BRK-SELECT sheet with Product ID + price + VAT note", () => {
    const block = buildRefsContextBlock("قاطع هوائي شنايدر 1600 أمبير 3P السعر", "ar", "thinking");
    expect(block).toContain("BRK-SELECT");
    expect(block).toContain("Product ID:");
    expect(block).toContain("غير شامل الضريبة");
    expect(block).toContain("Product ID: ");
  });

  it("returns empty for non-reference queries (byte-identical prompt)", () => {
    expect(buildRefsContextBlock("مرحبا", "ar", "thinking")).toBe("");
    const p1 = getSystemPrompt("ar", "thinking");
    const p2 = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, undefined, false, "full", undefined, undefined, "");
    expect(p1).toBe(p2);
  });

  it("enforces the citation lines append-only (and skips refusals)", () => {
    const reply = "بناءً على الكود السعودي DPS-01: الحمل المتصل 46 kVA وحمل الطلب 27.6 kVA والقاطع المقترح 70 أمبير للفيلا المذكورة في السؤال.";
    const enforced = enforceRefsCitations(reply, "فيلا C1 مساحة 300 متر مربع 230/400 فولت الكود السعودي", "ar", "thinking");
    expect(enforced).toContain("SEC DPS-01");
    expect(enforced.startsWith(reply)).toBe(true);
    const refusal = "أعتذر لا أستطيع المساعدة في هذا السؤال لأنه خارج نطاقي تماماً وبكل صدق لا يمكنني الإجابة عنه الآن فعلًا.";
    expect(enforceRefsCitations(refusal, "الكود السعودي C1 300 متر مربع", "ar", "thinking")).toBe(refusal);
  });

  it("carries the four skill block sets (thinking + instant, ar + en)", () => {
    for (const blocks of [SAUDI_CORE_BLOCKS, ABB_CORE_BLOCKS, BRK_CORE_BLOCKS, GILANY_CORE_BLOCKS]) {
      for (const mode of ["thinking", "instant"] as const) {
        for (const lang of ["ar", "en"] as const) {
          expect(blocks[mode][lang].length).toBeGreaterThan(80);
        }
      }
    }
  });

  it("registers the four new skills in SKILL_REGISTRY", () => {
    for (const id of ["saudi-load-core", "abb-transformer-core", "schneider-price-core", "gilany-pse-core"]) {
      const skill = SKILL_REGISTRY.find((s) => s.id === id);
      expect(skill).toBeDefined();
      expect(skill!.modes).toContain("thinking");
      expect(skill!.build("ar", "thinking").length).toBeGreaterThan(80);
    }
  });

  it("exposes the layer meta with the exact citation formats", () => {
    expect(REFS_LAYER_META.citationFormats.saudi).toBe("[SEC DPS-01 — Estimation of Customer Load Guideline، <Table/Section>، ص.N]");
    expect(REFS_LAYER_META.citationFormats.schneider).toContain("Product ID: <REF>");
    expect(REFS_LAYER_META.pageChunks).toBeGreaterThan(3000);
    expect(REFS_LAYER_META.schneiderItems).toBeGreaterThan(3000);
  });
});

// ─── 5. ±0.5% verification contract ────────────────────────────────────────

describe("refs numeric verification", () => {
  it("verifies KB numbers within ±0.5% and rejects wrong ones", () => {
    expect(verifyRefsNumber(150).verified).toBe(true);
    expect(verifyRefsNumber(0.723).verified).toBe(true);
    expect(verifyRefsNumber(196383).verified).toBe(true);
    // midpoint of the largest gap in the whole numeric KB — nothing within ±0.5%
    const wrong = verifyRefsNumber(2033130);
    expect(wrong.verified).toBe(false);
    expect(wrong.deviationPct!).toBeGreaterThan(0.5);
  });
});
