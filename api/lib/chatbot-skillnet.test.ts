/**
 * SKILLNET SKILL ROUTING LAYER — tests (v3.5.0, PROMPTS_CHANGELOG matrix)
 * ────────────────────────────────────────────────────────────────────────
 * 3-case matrix per the prompt-as-code discipline (happy / edge / failure):
 *   1. HAPPY: a domain question selects its cores + packs with reasons, and
 *      the composed prompt carries them while dropping the irrelevant cores.
 *   2. EDGE: live-screen/vision floor, instant quick anchors, registry
 *      integrity, signal extraction from multipart content.
 *   3. FAILURE MODE: no/empty signal → full-fallback superset of 3.4.0;
 *      non-technical message → lean prompt that still keeps every always-on
 *      block (guard, safety, evidence, platform, catalog fallback).
 */

import { describe, it, expect } from "vitest";

import { getSystemPrompt } from "./chatbot-prompts";
import {
  SKILL_REGISTRY,
  extractRoutingSignal,
  normalizeSignalText,
  routeSkills,
  validateSkillRegistry,
} from "./chatbot-skillnet";

// ─── Registry integrity (evaluate — SkillNet "evaluation") ─────────────────

describe("SKILL_REGISTRY integrity", () => {
  it("unique, well-formed ids and full bilingual content for enabled modes", () => {
    expect(validateSkillRegistry()).toEqual([]);
    const ids = SKILL_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the four new study packs (v3.5.0 additions)", () => {
    const ids = SKILL_REGISTRY.map((s) => s.id);
    for (const id of ["arc-flash-pack", "protection-coordination-pack", "load-flow-pack", "solar-pv-pack"]) {
      expect(ids).toContain(id);
    }
  });

  it("thinking-only cores expose no instant content (speed budget preserved)", () => {
    for (const skill of SKILL_REGISTRY.filter((s) => !s.modes.includes("instant"))) {
      expect(skill.build("ar", "instant")).toBe("");
      expect(skill.build("en", "instant")).toBe("");
    }
  });
});

// ─── HAPPY PATH: domain question → precise skill selection ────────────────

describe("routeSkills — happy path", () => {
  it("ETAP arc-flash question selects etap core + arc pack, drops PF/SKM/PVSyst", () => {
    const decision = routeSkills({
      signal: "كيف أعمل دراسة arc flash في ETAP خطوة بخطوة؟",
      lang: "ar",
      mode: "thinking",
    });
    expect(decision.strategy).toBe("routed");
    const ids = decision.selected.map((s) => s.id);
    expect(ids).toContain("etap-expert-core");
    expect(ids).toContain("arc-flash-pack");
    expect(decision.matchedSoftware).toContain("ETAP");
    const dropped = decision.dropped.map((d) => d.id);
    expect(dropped).toContain("powerfactory-core");
    expect(dropped).toContain("skm-core");
    expect(dropped).toContain("pvsyst-core");
    // Every ROUTABLE selection carries a human-readable reason (SkillNet
    // contract); always-on skills (identity cores + the v3.7.0 caveman
    // voice) legitimately carry score 0.
    const alwaysOnIds = new Set(SKILL_REGISTRY.filter((s) => s.alwaysOn).map((s) => s.id));
    for (const s of decision.selected) {
      if (alwaysOnIds.has(s.id)) continue;
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.score).toBeGreaterThan(0);
    }
    expect(decision.savedChars).toBeGreaterThan(0);
  });

  it("PVSyst solar question selects pvsyst core + solar pack only", () => {
    const decision = routeSkills({
      signal: "أنا أستخدم PVSyst لمشروع طاقة شمسية وأريد تحجيم السلاسل",
      lang: "ar",
      mode: "thinking",
    });
    const ids = decision.selected.map((s) => s.id);
    expect(ids).toContain("pvsyst-core");
    expect(ids).toContain("solar-pv-pack");
    expect(ids).not.toContain("powerfactory-core");
    expect(ids).not.toContain("skm-core");
    expect(decision.matchedSoftware).toContain("PVSyst");
  });

  it("protection coordination question selects the protection pack with CTI anchor", () => {
    const decision = routeSkills({
      signal: "كيف أضبط إعدادات الريليه وأتحقق من التنسيق بين القواطع؟",
      lang: "ar",
      mode: "thinking",
    });
    const ids = decision.selected.map((s) => s.id);
    expect(ids).toContain("protection-coordination-pack");
    expect(ids).toContain("etap-expert-core"); // relay/breaker/حماية keywords
  });
});

// ─── EDGE: live-screen floor, instant anchors, helpers ─────────────────────

describe("routeSkills — edge cases", () => {
  it("LIVE SCREEN lane: a short vague message keeps the identity cores, drops the rest", () => {
    const decision = routeSkills({
      signal: "ما الخطوة الجاية؟",
      lang: "ar",
      mode: "thinking",
      screenCapture: true,
    });
    // No routable skill matched → lean, but the identity cores ride along.
    expect(decision.strategy).toBe("lean");
    const ids = decision.selected.map((s) => s.id);
    expect(ids).toContain("etap-expert-core");
    expect(ids).toContain("electrical-depth-pack");
    expect(ids).not.toContain("powerfactory-core");
    // Identity cores are never routed out — their selection reason says so.
    for (const s of decision.selected) {
      if (s.id === "etap-expert-core" || s.id === "electrical-depth-pack") {
        expect(s.reasons.join(" ")).toMatch(/always-on/i);
      }
    }
  });

  it("instant mode returns quick anchors, never the full packs", () => {
    const decision = routeSkills({
      signal: "كيف أعمل arc flash في ETAP؟",
      lang: "ar",
      mode: "instant",
    });
    const arc = decision.selected.find((s) => s.id === "arc-flash-pack");
    expect(arc).toBeDefined();
    const content = SKILL_REGISTRY.find((s) => s.id === "arc-flash-pack")!.build("ar", "instant");
    expect(content).toContain("مرسى Arc Flash السريع");
    expect(content).not.toContain("حزمة تخصص");
  });

  it("normalizeSignalText collapses diacritics, alef and taa-marbuta variants", () => {
    expect(normalizeSignalText("الإِيتَاب مُخطَّطات")).toBe("الايتاب مخططات");
    expect(normalizeSignalText("مدرسة")).toContain("درسه");
  });

  it("extractRoutingSignal reads the last user message (string and multipart)", () => {
    expect(extractRoutingSignal([
      { role: "user", content: "سؤال قديم" },
      { role: "assistant", content: "جواب" },
      { role: "user", content: "السؤال الأخير عن arc flash" },
    ])).toBe("السؤال الأخير عن arc flash");

    expect(extractRoutingSignal([
      { role: "user", content: [
        { type: "text", text: "شوف الشاشة" },
        { type: "image_url", image_url: "data:image/jpeg;base64,..." },
      ] },
    ])).toBe("شوف الشاشة");

    expect(extractRoutingSignal([{ role: "assistant", content: "فقط" }])).toBe("");
  });
});

// ─── v3.7.0: ecosystem skills — caveman voice × find-skills discovery ─────

 describe("v3.7.0 ecosystem skills — caveman × find-skills", () => {
  it("registry carries both skills with the right category/modes/version", () => {
    const caveman = SKILL_REGISTRY.find((s) => s.id === "caveman-conciseness");
    const find = SKILL_REGISTRY.find((s) => s.id === "find-skills-discovery");
    expect(caveman).toBeDefined();
    expect(find).toBeDefined();
    expect(caveman!.category).toBe("voice-discipline");
    expect(find!.category).toBe("discovery");
    expect(caveman!.version).toBe("1.0.0");
    expect(find!.version).toBe("1.0.0");
    for (const mode of ["thinking", "instant"] as const) {
      for (const lang of ["ar", "en"] as const) {
        expect(caveman!.build(lang, mode).length).toBeGreaterThan(80);
        expect(find!.build(lang, mode).length).toBeGreaterThan(80);
      }
    }
  });

  it("caveman is always-on: rides along in a lean prompt in both modes and languages", () => {
    for (const mode of ["thinking", "instant"] as const) {
      for (const lang of ["ar", "en"] as const) {
        const decision = routeSkills({ signal: "شكراً جزيلاً", lang, mode });
        const ids = decision.selected.map((s) => s.id);
        expect(ids).toContain("caveman-conciseness");
        expect(ids).not.toContain("find-skills-discovery");
      }
    }
  });

  it("find-skills routes on an EE tool/skill discovery question (ar + en)", () => {
    const ar = routeSkills({ signal: "هل توجد مهارة تساعدني في حسابات Excel لجداول الأحمال؟", lang: "ar", mode: "thinking" });
    expect(ar.strategy).toBe("routed");
    expect(ar.selected.map((s) => s.id)).toContain("find-skills-discovery");

    const en = routeSkills({ signal: "Is there a skill for MATLAB simulation of motors?", lang: "en", mode: "thinking" });
    expect(en.selected.map((s) => s.id)).toContain("find-skills-discovery");
  });

  it("find-skills does NOT fire on the historical technical signals (no false positives)", () => {
    for (const signal of [
      "كيف أعمل دراسة arc flash في ETAP خطوة بخطوة؟",
      "أنا أستخدم PVSyst لمشروع طاقة شمسية وأريد تحجيم السلاسل",
      "كيف أضبط إعدادات الريليه وأتحقق من التنسيق بين القواطع؟",
      "ما الخطوة الجاية؟",
      "شكراً جزيلاً على الرد اللطيف",
      "اكتب لي قصة قصيرة",
    ]) {
      const decision = routeSkills({ signal, lang: "ar", mode: "thinking" });
      expect(decision.selected.map((s) => s.id)).not.toContain("find-skills-discovery");
    }
  });

  it("prompt level: full-fallback carries both skills; lean carries caveman only", () => {
    const full = getSystemPrompt("ar", "thinking");
    expect(full).toContain("مهارة الإيجاز الذكي");
    expect(full).toContain("مهارة اكتشاف المهارات");

    const lean = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "شكراً جزيلاً على الرد اللطيف");
    expect(lean).toContain("مهارة الإيجاز الذكي");
    expect(lean).not.toContain("مهارة اكتشاف المهارات");
  });

  it("prompt level: discovery question injects the find-skills protocol with vetting rules", () => {
    const p = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "هل توجد مهارة تساعدني في كتابة تقارير LaTeX للأبحاث الهندسية؟");
    expect(p).toContain("مهارة اكتشاف المهارات");
    expect(p).toContain("skills.sh");
    expect(p).toContain("npx skills find");
    // vetting discipline present
    expect(p).toContain("فحص الجودة إلزامي");
  });

  it("instant anchors exist and the instant routed prompt stays under the token budget", () => {
    expect(SKILL_REGISTRY.find((s) => s.id === "caveman-conciseness")!.build("ar", "instant"))
      .toContain("مرسى الإيجاز الذكي");
    expect(SKILL_REGISTRY.find((s) => s.id === "find-skills-discovery")!.build("ar", "instant"))
      .toContain("مرسى اكتشاف المهارات");

    const p = getSystemPrompt("ar", "instant", undefined, false, undefined, undefined, false, "هل توجد مهارة لمحاكاة MATLAB؟");
    expect(p.length).toBeLessThan(22_000);
    expect(p).toContain("مرسى الإيجاز الذكي");
    expect(p).toContain("مرسى اكتشاف المهارات");
  });

  it("English prompt mirrors the caveman discipline", () => {
    const p = getSystemPrompt("en", "thinking");
    expect(p).toContain("CONCISE VOICE SKILL");
    expect(p).toContain("negations (not, never, no, only, except)");
  });
});

// ─── FAILURE MODE: fallback superset + lean prompt keeps every always-on ────

describe("prompt composition — fallback and lean guarantees", () => {
  it("no signal → full-fallback prompt is a SUPERSET of every domain core + pack", () => {
    const p = getSystemPrompt("ar", "thinking");
    expect(p).toContain("ETAP EXPERT SYSTEM");
    expect(p).toContain("DIgSILENT POWERFACTORY KNOWLEDGE CORE");
    expect(p).toContain("SKM PTW (POWER*TOOLS) KNOWLEDGE CORE");
    expect(p).toContain("PVSYST KNOWLEDGE CORE");
    expect(p).toContain("حزمة العمق الكهربائي");
    expect(p).toContain("حزمة تخصص: دراسات Arc Flash");
    expect(p).toContain("حزمة تخصص: تنسيق الحماية");
    expect(p).toContain("حزمة تخصص: Load Flow");
    expect(p).toContain("حزمة تخصص: أنظمة الطاقة الشمسية");
    expect(p).toContain("قاعدة التنفيذ الفوري"); // sld skill intact
  });

  it("routed ETAP/arc-flash prompt drops the PF/SKM/PVSyst cores", () => {
    const p = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "كيف أعمل دراسة arc flash في ETAP؟");
    expect(p).toContain("ETAP EXPERT SYSTEM");
    expect(p).toContain("حزمة تخصص: دراسات Arc Flash");
    expect(p).not.toContain("DIgSILENT POWERFACTORY KNOWLEDGE CORE");
    expect(p).not.toContain("SKM PTW (POWER*TOOLS) KNOWLEDGE CORE");
    expect(p).not.toContain("PVSYST KNOWLEDGE CORE");
    // Always-on blocks survive routing untouched.
    expect(p).toContain("OUTPUT RULES");
    expect(p).toContain("السلامة الكهربائية");
  });

  it("non-technical message → identity cores stay, every routable skill dropped", () => {
    const decision = routeSkills({ signal: "شكراً جزيلاً على الرد اللطيف", lang: "ar", mode: "thinking" });
    expect(decision.strategy).toBe("lean");
    const ids = decision.selected.map((s) => s.id);
    expect(ids).toContain("etap-expert-core");
    expect(ids).toContain("electrical-depth-pack");
    expect(decision.savedChars).toBeGreaterThan(0);
    const p = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "شكراً جزيلاً على الرد اللطيف");
    expect(p).toContain("ETAP EXPERT SYSTEM");
    expect(p).toContain("حزمة العمق الكهربائي");
    expect(p).not.toContain("DIgSILENT POWERFACTORY KNOWLEDGE CORE");
    expect(p).not.toContain("SKM PTW (POWER*TOOLS) KNOWLEDGE CORE");
    expect(p).not.toContain("PVSYST KNOWLEDGE CORE");
    expect(p).not.toContain("قاعدة التنفيذ الفوري");
    expect(p).toContain("OUTPUT RULES");
    expect(p).toContain("السلامة الكهربائية");
    expect(p).toContain("نموذج مصدر الإجابة");
  });

  it("instant routed prompt stays under the token budget and carries quick anchors", () => {
    const p = getSystemPrompt("ar", "instant", undefined, false, undefined, undefined, false, "كيف أعمل arc flash في ETAP؟");
    expect(p.length).toBeLessThan(22_000);
    expect(p).toContain("مرسى Arc Flash السريع");
    expect(p).not.toContain("DIgSILENT POWERFACTORY KNOWLEDGE CORE");
  });

  it("screen-teacher lane keeps the technical floor even with a vague message", () => {
    const p = getSystemPrompt("ar", "thinking", undefined, true, undefined, undefined, true, "ما الخطوة الجاية؟");
    expect(p).toContain("ETAP EXPERT SYSTEM");
    expect(p).toContain("حزمة العمق الكهربائي");
    expect(p).toContain("وضع المعلّم المباشر");
  });

  it("vision pass-2 lane (routingFloor) keeps the full core set even when the reader failed", () => {
    // Mirrors the chatbot.test.ts vision contract: the reader failed, the
    // pass-2 signal is just the honesty note — the prompt must STILL carry
    // the ETAP deep-analysis core (historical guarantee, image was attached).
    const p = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "أعتذر، تعذّر قراءة الصورة المرفقة. هل يمكنك إعادة إرسالها؟", true);
    expect(p).toContain("DEEP-ANALYSIS PROTOCOL");
    expect(p).toContain("حزمة العمق الكهربائي");
  });

  it("English routed prompt mirrors the Arabic behavior", () => {
    const p = getSystemPrompt("en", "thinking", undefined, false, undefined, undefined, false, "How do I run an arc flash study in ETAP?");
    expect(p).toContain("SPECIALTY PACK: Arc Flash studies");
    expect(p).toContain("ETAP EXPERT SYSTEM");
    expect(p).not.toContain("PVSYST KNOWLEDGE CORE");
    expect(p).toContain("ELECTRICAL SAFETY RULE");
  });
});
