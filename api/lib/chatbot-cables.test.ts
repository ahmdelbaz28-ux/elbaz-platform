/**
 * CABLES & EGYPTIAN-CODE EXPERT CORE — tests (v1.0.0)
 * ────────────────────────────────────────────────────────────────────────
 * 3-case matrix per the prompt-as-code discipline (happy / edge / failure):
 *   1. HAPPY: KB integrity (20 ampacity tables + 4 SC tables + VD tables +
 *      derating + 18 Code sections), the DETERMINISTIC sizing engine against
 *      hand-computed values (load current → derating → ampacity → short
 *      circuit → voltage drop → governing criterion), BM25 retrieval
 *      grounding Code/catalogue questions in the right document, and the
 *      ±0.5% verification contract.
 *   2. EDGE: instant-mode budget, MV voltage coverage mapping (11kV → 8.7/15
 *      table only), grouping derating multiplication, citation enforcement
 *      (append-only, refusal guard).
 *   3. FAILURE MODE: no cables intent → empty context block (prompt
 *      byte-identical); no load figure → no CALC-SHEET; uncovered MV voltage
 *      → ok:false with an honest warning; wrong number → verified=false.
 */

import { describe, it, expect } from "vitest";

import {
  CABLES_CORE_BLOCKS,
  buildCablesContextBlock,
  enforceCablesCitations,
  hasCablesIntent,
  normalizeCablesText,
  parseSizingRequest,
  retrieveCables,
  sizeCable,
  verifyCablesNumber,
  CABLES_LAYER_META,
} from "./chatbot-cables";
import { AMPACITY_TABLES, KB_INTEGRITY_SAMPLER, SHORT_CIRCUIT_TABLES, SC_DURATIONS, VOLTAGE_DROP_MULTICORE, CATALOGUE_GUIDANCE } from "./chatbot-cables-kb";
import { EGYCODE_SECTIONS, EGYCODE_INTEGRITY_SAMPLER, EGYCODE_META } from "./chatbot-egycode-kb";
import { getSystemPrompt } from "./chatbot-prompts";
import { SKILL_REGISTRY, routeSkills } from "./chatbot-skillnet";

// ─── 1. Knowledge base integrity (evaluate) ────────────────────────────────

describe("ELSEWEDY-KB integrity", () => {
  it("carries the 20 ampacity tables with sane ascending csa rows", () => {
    expect(AMPACITY_TABLES.length).toBe(20);
    const ids = AMPACITY_TABLES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of AMPACITY_TABLES) {
      expect(t.rows.length).toBeGreaterThan(7);
      for (let i = 1; i < t.rows.length; i++) {
        expect(t.rows[i].csa).toBeGreaterThan(t.rows[i - 1].csa);
      }
      const primaryCol = t.cols[0];
      for (let i = 1; i < t.rows.length; i++) {
        const prev = (t.rows[i - 1] as unknown as Record<string, number>)[primaryCol];
        const cur = (t.rows[i] as unknown as Record<string, number>)[primaryCol];
        expect(cur).toBeGreaterThanOrEqual(prev * 0.97);
      }
    }
  });

  it("matches the verified sampler anchors (extraction provenance)", () => {
    const mc4CuXlpe25 = AMPACITY_TABLES.find((t) => t.id === "mc4_cu_xlpe")!.rows.find((r) => r.csa === 25)!;
    expect(mc4CuXlpe25.ground).toBe(KB_INTEGRITY_SAMPLER.ampMc4CuXlpe25Ground);
    const scRow = (SHORT_CIRCUIT_TABLES as Record<string, Record<number, number[]>>).cu_xlpe[800];
    expect(scRow[(SC_DURATIONS as unknown as number[]).indexOf(1)]).toBe(KB_INTEGRITY_SAMPLER.scCuXlpe800_1s);
    const vdRow = (VOLTAGE_DROP_MULTICORE as Record<string, Record<number, { pvc: number; xlpe: number }>>).cu[25];
    expect(vdRow.pvc).toBe(KB_INTEGRITY_SAMPLER.vdMc4Cu25Pvc);
    const scCuPvc50 = AMPACITY_TABLES.find((t) => t.id === "sc_cu_pvc")!.rows.find((r) => r.csa === 50)!;
    expect(scCuPvc50.groundFlat).toBe(KB_INTEGRITY_SAMPLER.ampScCuPvc50GroundFlat);
    // the known catalogue misprint is preserved verbatim + flagged
    const cuPvc10 = AMPACITY_TABLES.find((t) => t.id === "sc_cu_pvc")!.rows.find((r) => r.csa === 10)!;
    expect(cuPvc10.airFlatTouched).toBe(9);
    expect(AMPACITY_TABLES.find((t) => t.id === "sc_cu_pvc")!.notes?.length).toBeGreaterThan(0);
  });

  it("documents the catalogue basis and design guidance", () => {
    expect(CATALOGUE_GUIDANCE.voltageDropLimit).toContain("3-5");
    expect(CATALOGUE_GUIDANCE.selectionFactors.length).toBe(6);
  });
});

describe("EGYCODE-KB integrity", () => {
  it("carries the transcribed Code sections with clause citations", () => {
    expect(EGYCODE_SECTIONS.length).toBe(18);
    expect(EGYCODE_META.sectionCount).toBe(18);
    const ids = EGYCODE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of EGYCODE_SECTIONS) {
      expect(s.clause.length).toBeGreaterThan(2);
      expect(s.text.length).toBeGreaterThan(120);
      expect(s.keywords.length).toBeGreaterThan(5);
    }
  });

  it("matches the verified sampler values (Ch8 + Ch1 anchors)", () => {
    const trenches = EGYCODE_SECTIONS.find((s) => s.id === "trenches")!;
    expect(trenches.data?.lvWidthCm).toBe(EGYCODE_INTEGRITY_SAMPLER.trenchLvWidthCm);
    expect(trenches.data?.lvDepthCm).toBe(80);
    expect(trenches.data?.mvDepthCm).toBe(100);
    const fill = EGYCODE_SECTIONS.find((s) => s.id === "conduit-fill")!;
    expect(fill.data?.fillPct).toBe(40);
    expect(fill.data?.extraPctPerBend).toBe(10);
    const trays = EGYCODE_SECTIONS.find((s) => s.id === "cable-trays")!;
    expect(trays.data?.fillPct).toBe(50);
    const lighting = EGYCODE_SECTIONS.find((s) => s.id === "lighting-design")!;
    expect(lighting.data?.maintenanceRegular).toEqual([0.76, 1.0]);
    const fire = EGYCODE_SECTIONS.find((s) => s.id === "fire-pumps")!;
    expect(fire.data?.firePumpPowerKw).toBe(22);
  });
});

// ─── 2. Intent gate (edge) ─────────────────────────────────────────────────

describe("cables intent gate", () => {
  it("fires on sizing, catalogue and Code language", () => {
    for (const q of [
      "اختار لي كابل حمل 100 كيلووات طول 50 متر",
      "كم أمبير يتحمل كابل 95 مم² نحاس xlpe؟",
      "what is the ampacity of 4-core Cu XLPE cable?",
      "كام مساحة مقطع الكابل المناسب",
      "ما هي نسبة ملء الماسورة حسب الكود المصري؟",
      "معامل التجميع لثلاث دوائر مدفونة",
      "هبوط الجهد المسموح في الكتالوج",
      "قدرة محرك طلمبة الحريق",
      "معامل الصيانة للوحدات في الإنارة",
    ]) {
      expect(hasCablesIntent(q), q).toBe(true);
    }
  });

  it("stays silent on non-technical chatter", () => {
    for (const q of ["ازيك عامل ايه", "hello there", "اشترك ازاي في المنصة؟", "عامل ايه يا معلم"]) {
      expect(hasCablesIntent(q), q).toBe(false);
    }
  });

  it("normalizes Arabic-Indic digits and diacritics", () => {
    expect(normalizeCablesText("كابل ٩٥ مم٢")).toContain("95");
    expect(hasCablesIntent("أمبيراسية كابل ٩٥")).toBe(true);
  });
});

// ─── 3. Sizing engine — deterministic, hand-verified (happy) ───────────────

describe("sizing engine — happy path", () => {
  it("sizes 100kW/380V/3φ/50m with 25kA fault → SC governs at 185mm² Cu XLPE", () => {
    const result = sizeCable({ loadKw: 100, voltage: 380, phases: 3, pf: 0.8, lengthM: 50, conductor: "cu", insulation: "xlpe", cores: "multi", installation: "air", faultKa: 25, faultDurationS: 1 });
    // Ib = 100000 / (√3 × 380 × 0.8) = 189.9A
    expect(result.ok).toBe(true);
    expect(result.ib!.toFixed(1)).toBe("189.9");
    expect(result.derating).toBeCloseTo(1.0, 3);
    // SC check: cu_xlpe 1s — 185mm² = 26.5kA ≥ 25; 150mm² = 21.5 < 25
    expect(result.final!.csa).toBe(185);
    expect(result.governedBy).toBe("short-circuit");
    expect(result.final!.scKa).toBeCloseTo(26.5, 1);
    // ampacity at 185mm² must cover 189.9A in free air (4-core table)
    expect(result.final!.deratedAmp).toBeGreaterThanOrEqual(189.9);
    // VD at 50m on 185mm² XLPE multicore (0.212 mV/A/m) ≈ 0.53% ≤ 5%
    expect(result.final!.vdPct).not.toBeNull();
    expect(result.final!.vdPct!).toBeLessThan(5);
    // every step carries a citation and the sheet ends with references
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.join(" ")).toContain("Elsewedy");
  });

  it("applies ground grouping derating (3 circuits, trefoil, touching → 0.69)", () => {
    const result = sizeCable({ loadA: 200, conductor: "cu", insulation: "xlpe", cores: "multi", installation: "ground", groupingCircuits: 3, formation: "trefoil", spacing: "touching" });
    expect(result.ok).toBe(true);
    expect(result.derating).toBeCloseTo(0.69, 3);
    expect(result.requiredTabulatedAmp!).toBeCloseTo(200 / 0.69, 0);
    const t = AMPACITY_TABLES.find((x) => x.id === result.final!.tableId)!;
    const chosen = t.rows.find((r) => r.csa === result.final!.csa)!;
    expect(chosen.ground! * 0.69).toBeGreaterThanOrEqual(200);
  });

  it("raises the section when voltage drop governs on a long line", () => {
    const short = sizeCable({ loadKw: 30, voltage: 380, phases: 3, pf: 0.8, lengthM: 20, conductor: "al", insulation: "pvc", cores: "multi", installation: "air" });
    const long = sizeCable({ loadKw: 30, voltage: 380, phases: 3, pf: 0.8, lengthM: 400, conductor: "al", insulation: "pvc", cores: "multi", installation: "air", maxDropPct: 5 });
    expect(short.ok).toBe(true);
    expect(long.ok).toBe(true);
    expect(long.final!.csa).toBeGreaterThan(short.final!.csa);
    expect(long.final!.vdPct!).toBeLessThanOrEqual(5);
    expect(long.governedBy).toBe("voltage-drop");
  });

  it("sizes single-phase aluminium PVC from the single-core table", () => {
    const result = sizeCable({ loadA: 60, phases: 1, voltage: 220, conductor: "al", insulation: "pvc", installation: "air", formation: "trefoil" });
    expect(result.ok).toBe(true);
    // Al/PVC SC 16mm² air trefoil touched = 63A ≥ 60; 10mm² = 46 < 60
    expect(result.final!.csa).toBe(16);
    const t = AMPACITY_TABLES.find((x) => x.id === "sc_al_pvc")!;
    expect((t.rows.find((r) => r.csa === 16) as unknown as Record<string, number>).airTrefoilTouched).toBe(63);
  });

  it("maps an 11kV MV system to the 8.7/15kV table only", () => {
    const result = sizeCable({ loadKva: 2000, mvKv: 11, pf: 0.9, conductor: "cu", insulation: "xlpe", installation: "ground" });
    expect(result.ok).toBe(true);
    for (const f of result.families) {
      expect(f.voltage).toBe("8.7/15 (17.5) kV");
    }
    // Ib = 2000kVA / (√3 × 11kV) = 104.97A
    expect(result.ib!.toFixed(1)).toBe("105.0");
  });

  it("refuses uncovered MV voltages honestly (22kV)", () => {
    const result = sizeCable({ loadKva: 3000, mvKv: 22, conductor: "cu", insulation: "xlpe" });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("22kV");
  });

  it("states assumptions when inputs are defaulted", () => {
    const result = sizeCable({ loadKw: 50 });
    expect(result.ok).toBe(true);
    const assumptions = result.assumptions.join(" ");
    expect(assumptions).toContain("0.8");
    expect(assumptions).toContain("5%");
    expect(assumptions).toContain("380");
  });

  it("recommends parallel runs when the largest catalogue cable cannot carry the load", () => {
    const result = sizeCable({ loadA: 3000, conductor: "cu", insulation: "xlpe", cores: "multi", installation: "air" });
    expect(result.ok).toBe(false);
    expect(result.warnings.join(" ")).toContain("التوازي");
  });
});

// ─── 4. Request parsing (edge) ─────────────────────────────────────────────

describe("parseSizingRequest", () => {
  it("extracts load, length, conductor, insulation and fault data from Arabic text", () => {
    const req = parseSizingRequest("محتاج كابل نحاس xlpe لحمل 100 كيلووات ثلاثي الطور طول 50 متر وتيار قصر 25 ك.أ لمدة 1 ثانية");
    expect(req).not.toBeNull();
    expect(req!.loadKw).toBe(100);
    expect(req!.lengthM).toBe(50);
    expect(req!.conductor).toBe("cu");
    expect(req!.insulation).toBe("xlpe");
    expect(req!.faultKa).toBe(25);
    expect(req!.faultDurationS).toBe(1);
  });

  it("extracts amperes, kVA and MV voltage classes", () => {
    const amps = parseSizingRequest("تيار 150 أمبير في الأرض");
    expect(amps!.loadA).toBe(150);
    expect(amps!.installation).toBe("ground");
    const kva = parseSizingRequest("محول 1000 ك.ف.ا جهد 11 ك.ف");
    expect(kva!.loadKva).toBe(1000);
    expect(kva!.mvKv).toBe(11);
    const kw2 = parseSizingRequest("حمل ٢٥٠ ك.و مدفون في الأرض ٣ دوائر");
    expect(kw2!.loadKw).toBe(250);
    expect(kw2!.groupingCircuits).toBe(3);
    expect(kw2!.installation).toBe("ground");
  });

  it("returns null when no load figure exists (conceptual question)", () => {
    expect(parseSizingRequest("ما هو معامل التجميع في الأرض؟")).toBeNull();
    expect(parseSizingRequest("اشرح لي جدول هبوط الجهد")).toBeNull();
  });
});

// ─── 5. Retrieval + context block (happy/edge) ─────────────────────────────

describe("BM25 retrieval", () => {
  it("grounds the Code conduit-fill question in clause 8-2(ت)", () => {
    const hits = retrieveCables("ما هو الحد الأقصى لنسبة ملء الماسورة بالأسلاك حسب الكود المصري؟", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("egycode:conduit-fill");
    expect(hits[0].citation).toContain("8-2");
    expect(hits[0].excerpt).toContain("40%");
  });

  it("grounds an ampacity question in the right catalogue table", () => {
    const hits = retrieveCables("كم أمبير يتحمل كابل 4 قلوب نحاس xlpe مقطع 95 مم² في الأرض؟", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === "elsewedy:amp:mc4_cu_xlpe")).toBe(true);
  });

  it("grounds lighting-design queries in the Egyptian Code chapter 2", () => {
    const hits = retrieveCables("ازاي أحسب عدد وحدات الإنارة لقاعة؟ معامل الاستفادة ومعامل الصيانة", 2);
    expect(hits[0].id).toBe("egycode:lighting-design");
    expect(hits[0].citation).toContain("الباب 2");
  });
});

describe("buildCablesContextBlock", () => {
  it("returns empty string without cables intent (prompt byte-unchanged)", () => {
    expect(buildCablesContextBlock("ازيك يا معلم", "ar", "thinking")).toBe("");
    expect(buildCablesContextBlock("اشترك في الكورس", "ar", "instant")).toBe("");
  });

  it("embeds the CALC-SHEET + excerpts + citation lines for sizing queries", () => {
    const block = buildCablesContextBlock("اختار كابل لحمل 100 كيلووات طول 50 متر تيار قصر 25 ك.أ نحاس xlpe", "ar", "thinking");
    expect(block).toContain("CALC-SHEET");
    expect(block).toContain("189.9");
    expect(block).toContain("185");
    expect(block).toContain("CABLES-KB");
    expect(block).toContain("[Elsewedy Electric — Power Cables Catalogue");
  });

  it("embeds Code citation lines for clause questions (no CALC-SHEET)", () => {
    const block = buildCablesContextBlock("نسبة ملء الماسورة في الكود المصري؟", "ar", "instant");
    expect(block).not.toContain("CALC-SHEET");
    expect(block).toContain("8-2");
    expect(block).toContain("سطور الاستشهاد الإلزامية");
  });

  it("keeps the instant block token-light", () => {
    const block = buildCablesContextBlock("اختار كابل لحمل 60 ك.و طول 100 متر نحاس xlpe", "ar", "instant");
    expect(block.length).toBeLessThan(4200);
  });
});

// ─── 6. Verification contract (±0.5%) ──────────────────────────────────────

describe("verifyCablesNumber", () => {
  it("verifies a correct catalogue value within ±0.5%", () => {
    const v = verifyCablesNumber(114.5, ["elsewedy:sc"]);
    expect(v.verified).toBe(true);
    expect(v.matched).toBe(114.5);
    expect(v.context).toContain("800");
  });

  it("rejects a wrong value (verified=false)", () => {
    const v = verifyCablesNumber(999, ["elsewedy:sc"]);
    expect(v.verified).toBe(false);
  });

  it("verifies Code clause numbers", () => {
    const v = verifyCablesNumber(40, ["egycode:conduit-fill"]);
    expect(v.verified).toBe(true);
  });
});

// ─── 7. Citation enforcement (append-only contract) ────────────────────────

describe("enforceCablesCitations", () => {
  const query = "اختار كابل لحمل 100 كيلووات طول 50 متر تيار قصر 25 ك.أ نحاس xlpe";

  it("appends missing citation lines to an uncited reply", () => {
    const reply = "المقطع المناسب هو 185مم² نحاس XLPE للحمل المطلوب بعد تطبيق فحوصات القصر والأمبيراسية والهبوط على بيانات الكتالوج بالكامل.";
    const enforced = enforceCablesCitations(reply, query, "ar", "thinking");
    expect(enforced).toContain("[Elsewedy Electric — Power Cables Catalogue");
    expect(enforced.startsWith(reply)).toBe(true);
  });

  it("leaves an already-cited reply untouched", () => {
    const result = sizeCable(parseSizingRequest(query)!);
    const reply = `المقطع ${result.final!.csa}مم².\n\n${result.citations.join(" ")}`;
    const enforced = enforceCablesCitations(reply, query, "ar", "thinking");
    expect(enforced).toBe(reply);
  });

  it("never cites a refusal (anti-attribution guard)", () => {
    const refusal = "أعتذر لا أستطيع الإجابة على هذا السؤال الآن. يحتاج هذا الأمر مراجعة أدق وأرقام إضافية متعددة للتحقق منها قبل تقديم أي إجابة فنية موثوقة.";
    expect(enforceCablesCitations(refusal, query, "ar", "thinking")).toBe(refusal);
  });

  it("returns the reply unchanged for non-cables queries", () => {
    const reply = "منصة الباز فيها كورسات ETAP وSKM وPVSyst.";
    expect(enforceCablesCitations(reply, "ازاي اشترك؟", "ar", "thinking")).toBe(reply);
  });
});

// ─── 8. Skill registry + prompt integration ────────────────────────────────

describe("SKILL_REGISTRY routing + getSystemPrompt integration", () => {
  it("registers cables-expert-core with both modes", () => {
    const skill = SKILL_REGISTRY.find((s) => s.id === "cables-expert-core");
    expect(skill).toBeDefined();
    expect(skill!.modes).toContain("thinking");
    expect(skill!.modes).toContain("instant");
    expect(CABLES_CORE_BLOCKS.thinking.ar.length).toBeGreaterThan(400);
    expect(CABLES_CORE_BLOCKS.instant.ar.length).toBeGreaterThan(200);
  });

  it("routes the skill on cable-intent signals", () => {
    const decision = routeSkills({ signal: "اختار لي كابل نحاس xlpe لحمل 100 كيلووات", lang: "ar", mode: "thinking" });
    expect(decision.selected.some((s) => s.id === "cables-expert-core")).toBe(true);
  });

  it("drops the skill on non-technical signals but protects it in full-fallback", () => {
    const decision = routeSkills({ signal: "بس اشتراك شهري بكام", lang: "ar", mode: "thinking" });
    expect(decision.selected.some((s) => s.id === "cables-expert-core")).toBe(false);
    const fallback = routeSkills({ signal: "", lang: "ar", mode: "thinking" });
    expect(fallback.strategy).toBe("full-fallback");
    expect(fallback.selected.some((s) => s.id === "cables-expert-core")).toBe(true);
  });

  it("appends the cables block into the system prompt verbatim", () => {
    const block = buildCablesContextBlock("اختار كابل لحمل 100 كيلووات طول 50 متر تيار قصر 25 ك.أ", "ar", "thinking");
    const prompt = getSystemPrompt("ar", "thinking", "", false, undefined, undefined, false, "اختار كابل لحمل 100 كيلووات طول 50 متر تيار قصر 25 ك.أ", false, "full", "", block);
    expect(prompt).toContain("CALC-SHEET");
    expect(prompt.endsWith(block) || prompt.includes(block)).toBe(true);
  });

  it("keeps the prompt byte-identical without cablesContext (failure-mode guard)", () => {
    const without = getSystemPrompt("en", "instant");
    const withEmpty = getSystemPrompt("en", "instant", undefined, false, undefined, undefined, false, undefined, false, "full", "", "");
    expect(withEmpty).toBe(without);
  });

  it("exposes the layer meta for telemetry", () => {
    expect(CABLES_LAYER_META.ampacityTableCount).toBe(20);
    expect(CABLES_LAYER_META.egyCodeSectionCount).toBe(18);
    expect(CABLES_LAYER_META.docCount).toBe(49);
  });

  it("v3.9.2 cross-domain suppression: a Saudi-DPS question never drags the Elsewedy/EgyCode KB (owner: no unimportant file reads)", () => {
    // Load words («محركات», «إنارة») fire hasCablesIntent, but the question
    // belongs to the Saudi-DPS refs lane — with refsRouteActive the cables
    // block must stay EMPTY so the prompt carries only the asked source.
    const saudiQ = "احسب الأحمال حسب الكود السعودي DPS لمصنع به محركات 50 كيلووات وإنارة 10 كيلووات";
    expect(hasCablesIntent(saudiQ)).toBe(true); // load words fire the raw intent…
    expect(buildCablesContextBlock(saudiQ, "ar", "thinking", { refsRouteActive: true })).toBe(""); // …yet the KB is suppressed

    // Backward compat: without the cross-flag the legacy behavior is intact.
    expect(buildCablesContextBlock(saudiQ, "ar", "thinking").length).toBeGreaterThan(0);

    // An explicit cable noun overrides the suppression — both cores integrate.
    const saudiPlusCable = "احسب الأحمال حسب الكود السعودي DPS ثم اختر مقطع الكابل للتغذية الرئيسية";
    expect(buildCablesContextBlock(saudiPlusCable, "ar", "thinking", { refsRouteActive: true }).length).toBeGreaterThan(0);
  });
});
