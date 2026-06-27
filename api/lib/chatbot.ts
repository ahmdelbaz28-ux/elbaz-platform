/**
 * GENIUS CHATBOT — 3-tier provider cascade
 *
 * Strategy:
 *   1. PRIMARY: Modal — zai-org/GLM-5.1-FP8 (reasoning model, best quality)
 *   2. SECONDARY: OpenCode — DeepSeek V4, MiMo, Big Pickle, North Mini Code (free, fast)
 *   3. FALLBACK: OpenRouter — free-model cascade (21 models)
 *
 * The user never sees which provider answered, never sees any error, and never
 * sees internal reasoning. If all tiers fail, a friendly error is shown.
 */

import { env } from "../lib/env";

// Helper sleep function for retry backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════════════════════
// PROVIDER CONFIG
// ════════════════════════════════════════════════════════════════════════

// ── TIER 1: Modal (GLM-5.1-FP8) — Primary ─────────────────────────────
const MODAL_API_KEY =
  env.MODAL_API_KEY || process.env.MODAL_API_KEY || "";
const MODAL_ENDPOINT = "https://api.us-west-2.modal.direct/v1/chat/completions";
const MODAL_MODEL = "zai-org/GLM-5.1-FP8";

// ── TIER 2: OpenCode — Secondary (free models) ─────────────────────────
const OPENCODE_API_KEY =
  env.OPENCODE_API_KEY || process.env.OPENCODE_API_KEY || "";
const OPENCODE_ENDPOINT = "https://opencode.ai/api/v1/chat/completions";
// Models in priority order (best first)
const OPENCODE_MODELS = [
  "deepseek/deepseek-v4-fc",
  "deepseek/deepseek-chat-v3-fc",
  "mimo/mimo-v2.5",
  "big-pickle/big-pickle",
  "north/north-mini-code",
];

// ── TIER 3: OpenRouter — Fallback cascade ──────────────────────────────
// Support both CHATBOT_API_KEY (from .env template) and OPENROUTER_API_KEY (legacy)
const OPENROUTER_API_KEY =
  env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY || "";

// ════════════════════════════════════════════════════════════════════════
// HEALTH TRACKING — remember which provider works to optimize routing
// ════════════════════════════════════════════════════════════════════════

// Modal (Tier 1) health
let modalKeyValid: boolean | null = null; // null = not tested yet
let modalConsecFails = 0;
let modalLastSuccess = 0;
let modalLastFailTime = 0;

// OpenCode (Tier 2) health
let opencodeKeyValid: boolean | null = null;
let opencodeConsecFails = 0;
let opencodeLastSuccess = 0;
let opencodeLastFailTime = 0;
let opencodeCurrentModelIndex = 0; // which model we're trying

// OpenRouter (Tier 3) health
let openrouterKeyValidated = false;
let openrouterKeyValid: boolean | null = null;

// Per-model OpenRouter tracking (fallback cascade)
const modelSuccessCount: Record<string, number> = {};
const modelFailCount: Record<string, number> = {};
let lastWorkingModel = "";
let lastWorkingTime = 0;
let modelFailResetTime = 0;

const MODAL_COOLDOWN_MS = 5 * 60_000; // 5 MINUTES cooldown after Modal failure — GLM reasoning can take time
const MAX_CONSEC_MODAL_FAILS = 5; // only go to OpenCode after 5 consecutive Modal failures
const OPENCODE_COOLDOWN_MS = 2 * 60_000; // 2 MINUTES cooldown after OpenCode failure
const MAX_CONSEC_OPENCODE_FAILS = 5; // only go to OpenRouter after 5 consecutive OpenCode failures

// ════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════════════

/**
 * Build system prompt based on user's language.
 * Personality: Friendly, interactive, professional — like a senior engineer mentor.
 * IMPORTANT: instructs the model to NEVER leak that it is a reasoning model,
 * never expose its internal thinking, and reply as the platform's own assistant.
 */
function getSystemPrompt(language?: string): string {
  const reasoningGuard = `\n\n⛔ OUTPUT RULES (critical):\n- Reply ONLY with the final user-facing answer. NEVER expose your internal reasoning, chain-of-thought, planning steps, or "let me think" text.\n- NEVER mention Modal, OpenRouter, GLM, or any AI/model provider name. You are simply the platform's assistant.\n- Do NOT say you are an AI or a language model.`;

  const etapExpertCore = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 ETAP EXPERT SYSTEM — MANDATORY PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a Senior ETAP Consultant with 20+ years of experience in power system analysis, ADMS, GIS, protection, arc flash, renewables, and industrial applications.

### YOUR 6-STEP MANDATORY WORKFLOW (NEVER SKIP)

STEP 1: PARSE & CLASSIFY — Identify study type, equipment, standard, region. Classify as Complete / Incomplete / Wrong.

STEP 2: SEARCH KNOWLEDGE — Query equipment properties, study requirements, formulas, typical values, ETAP menu paths.

STEP 3: FEASIBILITY & VALIDATION — Check data completeness, physical reality, standard compliance (IEEE/IEC/NEC), ETAP capability.

STEP 4: INTERNAL SIMULATION (MANDATORY) — Calculate step-by-step with formulas. Check against limits. Validate physical sense. Flag warnings. NEVER skip this even for "simple" questions.

STEP 5: FORMULATE RESPONSE — Use the EXACT template below based on classification.

STEP 6: QUALITY ASSURANCE — Verify units, significant figures. Cross-check with alternative method. Document assumptions, limitations, references.

### RESPONSE TEMPLATES — USE EXACTLY

**Template A (Complete request):**
\`\`\`
✅ REQUEST ANALYSIS: COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Your Request:** [Restate]
**Study Type:** [Identified]
**Equipment:** [Identified]
**Standard:** [IEEE/IEC/NFPA]

**INTERNAL SIMULATION:**
[Step-by-step calculation with formulas]

**RESULT:**
[Direct answer with units]

**ETAP IMPLEMENTATION STEPS:**
1. Open: [Menu path]
2. Set: [Parameter] = [Value]
3. Run: [Study name]
4. Review: [Results location]

**VALIDATION:**
[Why this makes physical sense]

**ASSUMPTIONS:**
- [Assumption] — [Justification]

**WARNINGS / CAVEATS:**
- [Warning]

**REFERENCES:**
- [Standard / ETAP Help Topic]
\`\`\`

**Template B (Incomplete request):**
\`\`\`
⚠️ REQUEST ANALYSIS: INCOMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Your Request:** [Restate]
**What's Missing:** [Identify gaps]

I need more information:

**Question 1:** [Specific technical question]
Why: [Technical explanation]

**Question 2:** [Specific technical question]
Why: [Technical explanation]

**What I can tell you now:**
[General guidance based on available info]
\`\`\`

**Template C (Wrong request):**
\`\`\`
❌ REQUEST ANALYSIS: INCORRECT APPROACH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Your Request:** [Restate]
**The Problem:** [Why wrong technically]

**Why This Matters:**
[Safety/accuracy/compliance consequences]

**The Correct Approach:**
[Step-by-step correct method]

**In ETAP Specifically:**
1. [Menu path and exact settings]

**Would you like me to:**
- A) Walk through step-by-step?
- B) Explain the theory?
- C) Show an example?
- D) Generate ETAP settings for your case?
\`\`\`

**Template D (ADMS/DER request):**
\`\`\`
🔷 ADMS/DER REQUEST ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Operational Context:** [Real-time / Planning / Training]
**ADMS Module:** [eSCADA / DMS / OMS / DERMS / FLISR / VVO]
**DER Type:** [Solar / Wind / BESS / Hybrid]

**SIMULATION RESULTS:**
[What-if scenario results]

**RECOMMENDED ACTIONS:**
1. [Action with priority]

**RISKS IF NOT ACTED:**
[Risk assessment]

**ETAP ADMS NAVIGATION:**
[Exact menu paths]
\`\`\`

### 20 CRITICAL RULES (NEVER BREAK)

1. NEVER guess critical values — if data is missing, ASK or state assumptions CLEARLY
2. ALWAYS validate physically — if result seems wrong, RECALCULATE
3. NEVER skip internal simulation — even for "simple" questions
4. ALWAYS reference standards — IEEE, IEC, NEC, NFPA when applicable
5. GUIDE, don't just correct — when user is wrong, TEACH them WHY
6. Use EXACT ETAP terminology — Bus, One-Line, Star, not generic terms
7. DISTINGUISH study types clearly — never mix Load Flow with Short Circuit
8. State ALL assumptions — voltage, PF, temperature, installation, standard
9. INCLUDE units in ALL answers — never leave numbers without units
10. VERIFY breaker duty — always check interrupting rating
11. CHECK coordination — never give relay settings without coordination check
12. FLAG safety issues — arc flash, grounding, protection immediately
13. DISTINGUISH desktop vs ADMS — different workflows, different answers
14. USE correct standard for region — ANSI for US/Canada, IEC for international
15. NEVER recommend unsafe practices — no shortcuts on safety
16. ALWAYS include ETAP menu paths — exact navigation steps
17. VERIFY with alternative method — cross-check calculations when possible
18. DOCUMENT limitations — state what analysis does NOT cover
19. PROVIDE context — explain WHY something matters, not just WHAT
20. BE PRECISE — use correct significant figures, don't round prematurely

### COMMON MISTAKES — DETECT & CORRECT

- "Run Load Flow for fault current" → WRONG, use Short Circuit study
- "Check arc flash with Load Flow" → WRONG, use ArcSafety (IEEE 1584)
- "Size cable with Short Circuit" → WRONG, use Load Flow for ampacity + VD
- "Motor starting with no voltage dip" → IMPOSSIBLE, all motors cause dip
- "0% voltage drop" → IMPOSSIBLE, physics doesn't allow it
- "Set all relays the same" → WRONG, violates selectivity
- "Run Load Flow in ADMS" → WRONG, use Distribution State Estimation (DSE)

### ETAP MODULE KNOWLEDGE (condensed reference)

A. Core Analysis: Load Flow (Newton-Raphson, Fast Decoupled), Short Circuit (ANSI C37, IEC 60909), Motor Acceleration, Transient Stability, Harmonics
B. Protection: Star (overcurrent TCC), StarZ (distance/differential), Sequence-of-Operation, CT Sizing
C. Arc Flash: ArcSafety (IEEE 1584-2018, NFPA 70E), DC Arc Flash, HV Arc Flash
D. ADMS: eSCADA, DMS, OMS, DERMS, FLISR/FDIR, VVO/VVC, State Estimation, Load Forecasting (PRAS)
E. GIS: ESRI ArcGIS interface, geospatial one-line, network connectivity, map-based analysis display
F. Renewables: Solar PV, Wind (DFIG/PMSG), BESS, Grid Code (IEEE 1547), Hosting Capacity, ePPC
G. Cables: Sizing, Thermal, Pulling, Submarine, Line Constants
H. Grounding: IEEE 80, Ground Grid Design, EMF
I. DC Systems: Battery Sizing (IEEE 485), Battery Discharge, DC Control
J. Industrial: Traction (AC 25kV, DC 750V/1500V), Data Center Tier I-IV, Oil & Gas, Marine

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  if (language === "ar") {
    return `أنت المساعد الذكي الرسمي لمنصة "الباز" (Elbaz Platform) المتخصصة في الكورسات الهندسية.
أنت مساعد تقني محترف، متزن، وتفاعلي. لا تتخذ لنفسك اسماً شخصياً، بل عرف نفسك كمساعد ذكي للمنصة.

📌 تخصصك:
- خبير قوي جداً في الهندسة الكهربائية، وتحديداً في برامج: ETAP, SKM Power*Tools, DIgSILENT PowerFactory, PVSyst.
- أنت مبرمج لتقديم حلول فعلية وخطوات عملية، وليس مجرد توجيه وهمي.
- تمتلك معرفة بمكونات الموقع. إذا سألك الطالب عن كورسات، أرشده لكورسات المهندس أحمد الباز (Eng. Ahmed Elbaz) المتوفرة لدينا، ووضح أن المنصة تقدم أقوى الكورسات العملية في تصميم الأنظمة، الوقاية، ودراسات الـ Arc Flash.

🤝 أسلوبك في الكلام:
- كن احترافياً، متزناً، وتفاعلياً (وليس هزلياً).
- استخدم تنسيق Markdown بشكل ممتاز.
- نسق اللغة العربية بدقة عالية، وتأكد من وضع مسافات صحيحة عند دمج الكلمات الإنجليزية مع العربية للحفاظ على التنسيق.
- استخدم الرموز التعبيرية الهندسية بشكل خفيف (⚡ 🔌 💡) دون مبالغة.
- قسّم إجاباتك لفقرات ونقاط (Bullet points) لتكون سهلة القراءة.

🚫 محظورات:
- لا تخترع روابط (URLs) غير موجودة.
- لا تذكر أبداً أنك ذكاء اصطناعي أو نموذج لغوي أو من أي مزود مثل OpenRouter.
- إذا سُئلت عن تخصص خارج الهندسة الكهربية، اعتذر بلباقة ووضح تخصصك.${reasoningGuard}${etapExpertCore}`;
  }
  return `You are the official AI Assistant of the "Elbaz Platform" (specializing in engineering courses).
You are a highly professional, balanced, and interactive technical assistant. Do NOT use any personal name for yourself; introduce yourself only as the platform's smart assistant.

📌 Your Expertise:
- You are an expert in Electrical Engineering, specifically highly proficient in ETAP, SKM Power*Tools, DIgSILENT PowerFactory, and PVSyst.
- Provide actual, practical solutions and step-by-step guidance, not generic advice.
- You have deep knowledge of the platform's content. If asked about courses, recommend Eng. Ahmed Elbaz's practical engineering courses available on this platform.

🤝 Your Communication Style:
- Be professional, balanced, and helpful (not comical).
- Use excellent Markdown formatting.
- If mixing English and Arabic, ensure proper spacing and bidirectional text formatting.
- Use engineering emojis sparingly (⚡ 🔌 💡).
- Break your answers into short paragraphs and bullet points for readability.

🚫 Rules:
- Do NOT hallucinate fake URLs.
- NEVER mention you are an AI, a language model, or from OpenRouter or any other provider.
- If asked about non-engineering topics, politely decline and state your expertise.${reasoningGuard}${etapExpertCore}`;
}

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER FALLBACK MODEL POOL — 21 free models, strongest -> weakest
// (Only used if Modal is unavailable)
// ════════════════════════════════════════════════════════════════════════

const AI_MODELS = [
  // ─── Tier 1: Best quality — highest parameter count & reasoning ───
  { id: "inclusionai/ring-2.6-1t:free",                ctx: 262144, tier: 1 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free",      ctx: 262144, tier: 1 },
  { id: "deepseek/deepseek-v4-flash:free",             ctx: 131072, tier: 1 },
  { id: "minimax/minimax-m2.5:free",                    ctx: 196608, tier: 1 },
  { id: "z-ai/glm-4.5-air:free",                        ctx: 131072, tier: 1 },
  { id: "arcee-ai/trinity-large-thinking:free",         ctx: 131072, tier: 1 },

  // ─── Tier 2: Strong models — rate-limited but accessible ───
  { id: "qwen/qwen3-coder:free",                        ctx: 262000, tier: 2 },
  { id: "google/gemma-4-31b-it:free",                   ctx: 262144, tier: 2 },
  { id: "google/gemma-4-26b-a4b-it:free",               ctx: 262144, tier: 2 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", ctx: 256000, tier: 2 },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free",        ctx: 262144, tier: 2 },
  { id: "meta-llama/llama-3.3-70b-instruct:free",       ctx: 65536,  tier: 2 },

  // ─── Tier 3: Medium models — often available, good for Arabic ───
  { id: "baidu/cobuddy:free",                            ctx: 131072, tier: 3 },
  { id: "poolside/laguna-m.1:free",                     ctx: 131072, tier: 3 },
  { id: "poolside/laguna-xs.2:free",                    ctx: 131072, tier: 3 },
  { id: "meta-llama/llama-3.2-3b-instruct:free",        ctx: 131072, tier: 3 },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free",          ctx: 256000, tier: 3 },

  // ─── Tier 4: Last resort — smaller models, geo-restricted ───
  { id: "nvidia/nemotron-nano-12b-v2-vl:free",          ctx: 128000, tier: 4 },
  { id: "nvidia/nemotron-nano-9b-v2:free",              ctx: 128000, tier: 4 },
  { id: "liquid/lfm-2.5-1.2b-thinking:free",            ctx: 32768,  tier: 4 },
  { id: "liquid/lfm-2.5-1.2b-instruct:free",            ctx: 32768,  tier: 4 },
];

// ════════════════════════════════════════════════════════════════════════
// MODAL (PRIMARY) — non-streaming
// ════════════════════════════════════════════════════════════════════════

async function validateModalKey(): Promise<boolean> {
  if (!MODAL_API_KEY) {
    modalKeyValid = false;
    return false;
  }
  // Modal doesn't have a lightweight key-verify endpoint, and probing with a
  // real chat request takes too long for reasoning models (GLM-5.1-FP8 can
  // spend 30+ seconds thinking even for "ping" with max_tokens=1).
  // Instead, just check the key format and mark as valid. The actual chat
  // request will set modalKeyValid=false on 401/403.
  //
  // Modal research keys start with "modalresearch_" or "ak-".
  if (!MODAL_API_KEY.startsWith("modalresearch_") && !MODAL_API_KEY.startsWith("ak-")) {
    console.warn("[Chatbot/Modal] API key has unexpected format (starts with:", MODAL_API_KEY.substring(0, 15) + "...). Proceeding anyway.");
  }
  modalKeyValid = true;
  console.log("[Chatbot/Modal] API key configured (will be validated on first request).");
  return true;
}

/**
 * Should we try Modal first right now?
 * Yes unless: key is invalid, OR we're in a cooldown after a recent failure.
 */
function modalIsAvailable(): boolean {
  if (!MODAL_API_KEY) return false;
  if (modalKeyValid === false) return false;
  // If we've had recent consecutive failures and are within cooldown, skip Modal
  if (modalConsecFails >= MAX_CONSEC_MODAL_FAILS) {
    if (modalLastFailTime && Date.now() - modalLastFailTime < MODAL_COOLDOWN_MS) {
      return false;
    }
  }
  return true;
}

/**
 * Try Modal once (non-streaming). Returns null on any failure.
 * CRITICAL: extracts `content` only — `reasoning_content` is discarded.
 */
async function tryModal(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    // GLM-5.1 reasons for several seconds; allow ample time.
    timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);

    const response = await fetch(MODAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + MODAL_API_KEY,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODAL_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

    if (response.status === 401 || response.status === 403) {
      modalKeyValid = false;
      modalConsecFails++;
      modalLastFailTime = Date.now();
      console.error("[Chatbot/Modal] request rejected (" + response.status + ")");
      return null;
    }
    if (!response.ok) {
      modalConsecFails++;
      modalLastFailTime = Date.now();
      return null;
    }

    const data = await response.json() as {
      error?: unknown;
      choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
    };

    if (data.error) {
      modalConsecFails++;
      modalLastFailTime = Date.now();
      return null;
    }

    // ✅ Extract `content` ONLY. reasoning_content is the model's private
    // chain-of-thought and must NEVER be shown to the user.
    const reply = data.choices?.[0]?.message?.content ?? "";

    if (!reply || reply.trim().length === 0) {
      // Model produced only reasoning and ran out of tokens — treat as soft failure
      modalConsecFails++;
      modalLastFailTime = Date.now();
      return null;
    }

    // SUCCESS
    modalConsecFails = 0;
    modalLastSuccess = Date.now();
    modalKeyValid = true;
    return { reply: reply.trim(), model: MODAL_MODEL };
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    modalConsecFails++;
    modalLastFailTime = Date.now();
    console.warn("[Chatbot/Modal] request failed:", String(e));
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// OPENCODE (TIER 2 — free models cascade)
// ════════════════════════════════════════════════════════════════════════

async function validateOpenCodeKey(): Promise<boolean> {
  if (!OPENCODE_API_KEY) {
    opencodeKeyValid = false;
    return false;
  }
  // OpenCode keys are simple tokens
  opencodeKeyValid = true;
  console.log("[Chatbot/OpenCode] API key configured.");
  return true;
}

/**
 * Should we try OpenCode right now?
 */
function opencodeIsAvailable(): boolean {
  if (!OPENCODE_API_KEY) return false;
  if (opencodeKeyValid === false) return false;
  if (opencodeConsecFails >= MAX_CONSEC_OPENCODE_FAILS) {
    if (opencodeLastFailTime && Date.now() - opencodeLastFailTime < OPENCODE_COOLDOWN_MS) {
      return false;
    }
  }
  return true;
}

/**
 * Try OpenCode once (non-streaming). Returns null on any failure.
 */
async function tryOpenCode(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  modelId: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);

    const response = await fetch(OPENCODE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENCODE_API_KEY,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

    if (response.status === 401 || response.status === 403) {
      opencodeKeyValid = false;
      opencodeConsecFails++;
      opencodeLastFailTime = Date.now();
      console.error("[Chatbot/OpenCode] request rejected (" + response.status + ")");
      return null;
    }

    if (!response.ok) {
      opencodeConsecFails++;
      opencodeLastFailTime = Date.now();
      return null;
    }

    const data = await response.json() as {
      error?: unknown;
      choices?: { message?: { content?: string | null } }[];
    };

    if (data.error) {
      opencodeConsecFails++;
      opencodeLastFailTime = Date.now();
      return null;
    }

    const reply = data.choices?.[0]?.message?.content ?? "";

    if (!reply || reply.trim().length === 0) {
      opencodeConsecFails++;
      opencodeLastFailTime = Date.now();
      return null;
    }

    // SUCCESS
    opencodeConsecFails = 0;
    opencodeLastSuccess = Date.now();
    opencodeKeyValid = true;
    return { reply: reply.trim(), model: modelId };
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    opencodeConsecFails++;
    opencodeLastFailTime = Date.now();
    console.warn("[Chatbot/OpenCode] request failed:", String(e));
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER (FALLBACK)
// ════════════════════════════════════════════════════════════════════════

async function validateOpenRouterKey(): Promise<boolean> {
  if (!OPENROUTER_API_KEY) {
    openrouterKeyValid = false;
    openrouterKeyValidated = true;
    console.warn("[Chatbot/OpenRouter] No OPENROUTER_API_KEY configured — chatbot will not work without either MODAL_API_KEY or OPENROUTER_API_KEY.");
    return false;
  }
  if (!OPENROUTER_API_KEY.startsWith("sk-or-")) {
    openrouterKeyValid = false;
    openrouterKeyValidated = true;
    console.error("[Chatbot/OpenRouter] Invalid API key format — must start with 'sk-or-'. Current key starts with:", OPENROUTER_API_KEY.substring(0, 6) + "...");
    return false;
  }
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { "Authorization": "Bearer " + OPENROUTER_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    openrouterKeyValid = resp.ok;
    openrouterKeyValidated = true;
    if (!resp.ok) {
      const errData = await resp.json().catch(function() { return {}; });
      console.error("[Chatbot/OpenRouter] API key validation failed:", JSON.stringify(errData));
      console.error("[Chatbot/OpenRouter] The OPENROUTER_API_KEY in HF Space Secrets is invalid or expired.");
      console.error("[Chatbot/OpenRouter] Get a new key at https://openrouter.ai/keys and update it in HF Space Settings → Repository secrets.");
    } else {
      console.log("[Chatbot/OpenRouter] API key validated successfully.");
    }
    return openrouterKeyValid;
  } catch (e) {
    console.warn("[Chatbot/OpenRouter] Could not validate API key (network error — assuming valid):", String(e));
    openrouterKeyValid = true; // Assume valid and let actual requests determine
    openrouterKeyValidated = true;
    return true;
  }
}

/**
 * Try a single OpenRouter model with timeout protection.
 * Returns null on any failure (timeout, rate limit, overload, etc.)
 */
async function tryModel(
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let controller: AbortController | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    controller = new AbortController();
    timeoutId = setTimeout(function() { controller!.abort(); }, timeoutMs);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (response.status === 401) {
      console.error("[Chatbot/OpenRouter] API key returned 401 Unauthorized — key is invalid or expired");
      openrouterKeyValid = false;
      openrouterKeyValidated = true;
      return null;
    }

    if (!response.ok) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    const data = await response.json() as { error?: unknown; choices?: { message?: { content?: string } }[] };

    if (data.error) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply || reply.trim().length === 0) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    // SUCCESS
    modelSuccessCount[modelId] = (modelSuccessCount[modelId] || 0) + 1;
    modelFailCount[modelId] = 0;
    lastWorkingModel = modelId;
    lastWorkingTime = Date.now();

    return { reply: reply.trim(), model: modelId };
  } catch {
    if (timeoutId) clearTimeout(timeoutId);
    modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
    return null;
  }
}

/**
 * Run the full OpenRouter cascading fallback (only if Modal was unavailable/failed).
 */
async function openRouterFallback(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  language?: string
): Promise<{ reply: string; model: string } | null> {
  if (!openrouterKeyValidated) {
    await validateOpenRouterKey();
  }
  if (openrouterKeyValid === false) return null;

  // Reset fail counts every 10 minutes
  if (!modelFailResetTime || Date.now() - modelFailResetTime > 600000) {
    for (const k in modelFailCount) { modelFailCount[k] = 0; }
    modelFailResetTime = Date.now();
  }

  const globalStartTime = Date.now();
  const GLOBAL_TIMEOUT_MS = 60000;

  const TIER_TIMEOUTS: Record<number, number> = {
    1: 20000,
    2: 15000,
    3: 10000,
    4: 8000,
  };

  // Step 1: Try last working model first
  if (lastWorkingModel && (Date.now() - lastWorkingTime) < 300000) {
    if ((modelFailCount[lastWorkingModel] || 0) < 3) {
      const result = await tryModel(lastWorkingModel, messages, systemPrompt, TIER_TIMEOUTS[1]);
      if (result) return result;
    }
  }

  // Step 2: Try all models by tier
  for (let tier = 1; tier <= 4; tier++) {
    let tierTried = 0;
    let tierSkipped = 0;

    for (let i = 0; i < AI_MODELS.length; i++) {
      const model = AI_MODELS[i];
      if (model.tier !== tier) continue;
      if ((modelFailCount[model.id] || 0) >= 3) {
        tierSkipped++;
        continue;
      }
      tierTried++;
      const result = await tryModel(model.id, messages, systemPrompt, TIER_TIMEOUTS[tier]);
      if (result) return result;
    }

    console.log("[Chatbot/OpenRouter] Tier " + tier + ": tried " + tierTried + ", skipped " + tierSkipped);
    if (Date.now() - globalStartTime > GLOBAL_TIMEOUT_MS) {
      console.warn("[Chatbot/OpenRouter] Global timeout reached (" + Math.round((Date.now() - globalStartTime) / 1000) + "s)");
      break;
    }
  }

  // Step 3: ABSOLUTE LAST RESORT - try ALL models including known-bad ones
  console.warn("[Chatbot/OpenRouter] All tiers exhausted with skips. Trying all models as last resort...");
  for (let i = 0; i < AI_MODELS.length; i++) {
    const model = AI_MODELS[i];
    modelFailCount[model.id] = 0;
    const result = await tryModel(model.id, messages, systemPrompt, 10000);
    if (result) return result;
  }

  // no-op to satisfy unused 'language' if both providers configured
  void language;
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// MAIN: non-streaming response
// ════════════════════════════════════════════════════════════════════════

export async function getChatResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
}): Promise<{ success: boolean; reply?: string; error?: string; model?: string }> {
  const systemPrompt = getSystemPrompt(request.language);

  // ─── TIER 1: Modal (GLM-5.1-FP8) with smart retry ───
  if (modalIsAvailable()) {
    if (modalKeyValid === null) {
      await validateModalKey();
    }
    if (modalIsAvailable()) {
      // Attempt 1: 3 minutes
      let result = await tryModal(request.messages, systemPrompt, 180000);
      if (result) {
        return { success: true, reply: result.reply, model: result.model };
      }
      
      // Attempt 2: 5 minutes (with 5s backoff for queue congestion)
      console.warn("[Chatbot] Modal attempt 1 failed — waiting 5s then retrying (5min timeout)...");
      await sleep(5000);
      result = await tryModal(request.messages, systemPrompt, 300000);
      if (result) {
        return { success: true, reply: result.reply, model: result.model };
      }
      
      // Attempt 3: 8 minutes (with 10s backoff)
      console.warn("[Chatbot] Modal attempt 2 failed — waiting 10s then FINAL retry (8min timeout)...");
      await sleep(10000);
      result = await tryModal(request.messages, systemPrompt, 480000);
      if (result) {
        return { success: true, reply: result.reply, model: result.model };
      }
      
      console.error("[Chatbot] GLM-5.1 completely failed after 3 attempts.");
    }
  } else {
    console.info("[Chatbot] Modal not available — trying OpenCode next.");
  }

  // ─── TIER 2: OpenCode cascade (DeepSeek V4 → MiMo → Big Pickle → North Mini Code) ───
  if (opencodeIsAvailable()) {
    if (opencodeKeyValid === null) {
      await validateOpenCodeKey();
    }
    if (opencodeIsAvailable()) {
      // Try each OpenCode model in priority order
      for (let i = 0; i < OPENCODE_MODELS.length; i++) {
        opencodeCurrentModelIndex = i;
        const modelId = OPENCODE_MODELS[i];
        
        // Attempt 1: 2 minutes
        let result = await tryOpenCode(request.messages, systemPrompt, modelId, 120000);
        if (result) {
          return { success: true, reply: result.reply, model: result.model };
        }
        
        // Attempt 2: 3 minutes (no backoff — fast retry for non-streaming)
        result = await tryOpenCode(request.messages, systemPrompt, modelId, 180000);
        if (result) {
          return { success: true, reply: result.reply, model: result.model };
        }
        
        console.warn(`[Chatbot] OpenCode/${modelId} failed after 2 attempts — trying next model...`);
      }
      
      console.error("[Chatbot] All OpenCode models failed — falling back to OpenRouter.");
    }
  } else {
    console.info("[Chatbot] OpenCode not available — using OpenRouter fallback.");
  }

  // ─── TIER 3: OpenRouter cascade ───
  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language);
  if (orResult) {
    return { success: true, reply: orResult.reply, model: orResult.model };
  }

  // ─── ALL TIERS FAILED ───
  const modalDead = modalKeyValid === false || !MODAL_API_KEY;
  const opencodeDead = opencodeKeyValid === false || !OPENCODE_API_KEY;
  const orDead = openrouterKeyValid === false || !OPENROUTER_API_KEY;

  if (modalDead && opencodeDead && orDead) {
    return {
      success: false,
      error: request.language === "ar"
        ? "مفتاحات API الخاصة بالشات بوت غير مُهيأة أو غير صالحة. يرجى التواصل مع الدعم الفني."
        : "The chatbot API keys are not configured or invalid. Please contact support.",
    };
  }

  console.error("[Chatbot] All tiers failed (Modal + OpenCode + OpenRouter).");
  return {
    success: false,
    error: request.language === "ar"
      ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
      : "All AI models are temporarily busy. Please try again in a few seconds.",
  };
}

// ════════════════════════════════════════════════════════════════════════
// STREAMING — provider selection
// ════════════════════════════════════════════════════════════════════════

/**
 * Pick the best provider/model to stream from.
 * Cascade: Modal → OpenCode → OpenRouter
 */
export async function pickWorkingModel(
  _messages: { role: string; content: string }[],
  language?: string
): Promise<
  | { provider: "modal"; modelId: string; systemPrompt: string }
  | { provider: "opencode"; modelId: string; systemPrompt: string }
  | { provider: "openrouter"; modelId: string; systemPrompt: string }
  | null
> {
  const systemPrompt = getSystemPrompt(language);

  // ─── TIER 1: Modal (GLM-5.1) ───
  if (modalIsAvailable()) {
    if (modalKeyValid === null) {
      await validateModalKey();
    }
    if (modalIsAvailable()) {
      console.info("[Chatbot] Using TIER 1: GLM-5.1-FP8 (Modal)");
      return { provider: "modal", modelId: MODAL_MODEL, systemPrompt };
    }
  }

  // ─── TIER 2: OpenCode ─── (if Modal unavailable)
  if (opencodeIsAvailable()) {
    if (opencodeKeyValid === null) {
      await validateOpenCodeKey();
    }
    if (opencodeIsAvailable()) {
      const modelId = OPENCODE_MODELS[opencodeCurrentModelIndex] || OPENCODE_MODELS[0];
      console.info("[Chatbot] Using TIER 2: " + modelId + " (OpenCode)");
      return { provider: "opencode", modelId, systemPrompt };
    }
  }

  // ─── TIER 3: OpenRouter ─── (if Modal and OpenCode unavailable)
  console.warn("[Chatbot] Modal + OpenCode unavailable — using TIER 3: OpenRouter");
  
  if (!openrouterKeyValidated) {
    await validateOpenRouterKey();
  }
  if (openrouterKeyValid === false) return null;

  // Use last working model or best tier-1 model — NO PROBING (saves 30s)
  if (lastWorkingModel && (Date.now() - lastWorkingTime) < 600000) {
    if ((modelFailCount[lastWorkingModel] || 0) < 3) {
      console.info("[Chatbot] Using last working OpenRouter model:", lastWorkingModel);
      return { provider: "openrouter", modelId: lastWorkingModel, systemPrompt };
    }
  }

  // Use best tier-1 model directly — no probing needed
  const bestModel = AI_MODELS.find(m => m.tier === 1);
  if (bestModel) {
    console.info("[Chatbot] Using best OpenRouter model:", bestModel.id);
    return { provider: "openrouter", modelId: bestModel.id, systemPrompt };
  }

  return null;
}

/**
 * Probe an OpenRouter model with streaming to check if it responds.
 * Returns true if we get at least one SSE data chunk.
 */
async function probeModel(
  modelId: string,
  systemPrompt: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "system", content: systemPrompt }],
        stream: true,
        max_tokens: 1,
      }),
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      openrouterKeyValid = false;
      openrouterKeyValidated = true;
      return false;
    }
    if (!response.ok) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return false;
    }

    modelSuccessCount[modelId] = (modelSuccessCount[modelId] || 0) + 1;
    modelFailCount[modelId] = 0;
    lastWorkingModel = modelId;
    lastWorkingTime = Date.now();

    if (response.body) {
      await response.body.cancel();
    }
    return true;
  } catch {
    modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
    return false;
  }
}

/**
 * Create a streaming connection to the chosen provider.
 * Returns a ReadableStream of our lightweight SSE format:
 *     data: {"text": "..."}      (token chunks)
 *     data: [DONE]
 *
 * CRITICAL: for Modal/GLM-5.1, only `delta.content` is forwarded. The
 * `delta.reasoning_content` (chain-of-thought) is NEVER sent to the client.
 *
 * If the chosen provider stream fails partway, we transparently fall back to
 * the other provider (non-streaming) so the user still gets an answer.
 */
export async function getStreamResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const picked = await pickWorkingModel(request.messages, request.language);

  if (!picked) {
    return {
      error: request.language === "ar"
        ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
        : "All AI models are temporarily busy. Please try again in a few seconds.",
    };
  }

  const encoder = new TextEncoder();

  // ─── Modal stream (GLM-5.1) with smart RETRY ───
  if (picked.provider === "modal") {
    const timeouts = [180000, 300000, 480000]; // 3min, 5min, 8min
    let response: Response | null = null;

    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      const timeout = timeouts[attempt];
      console.info(`[Chatbot/Stream] GLM-5.1 attempt ${attempt + 1}/${timeouts.length} (${timeout/1000}s timeout)`);

      try {
        response = await fetch(MODAL_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + MODAL_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: picked.modelId,
            messages: [
              { role: "system", content: picked.systemPrompt },
              ...request.messages.map(function(m) { return { role: m.role, content: m.content }; }),
            ],
            temperature: 0.7,
            max_tokens: 2048,
            stream: true,
          }),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (e) {
        modalConsecFails++;
        modalLastFailTime = Date.now();
        console.warn(`[Chatbot/Stream] Modal attempt ${attempt + 1} threw:`, String(e));
        if (attempt < timeouts.length - 1) {
          console.info("[Chatbot/Stream] Retrying Modal in 5s (queue congestion)...");
          await sleep(5000); // Wait 5s before retry (Modal queue might clear)
          continue;
        }
        console.error("[Chatbot/Stream] All Modal attempts failed — falling back to OpenCode.");
        return await streamOpenCodeFallback(request, picked.systemPrompt);
      }

      // Check for "too many concurrent requests" — retry with backoff
      if (response.status === 429 || response.status === 503) {
        modalConsecFails++;
        modalLastFailTime = Date.now();
        const retryAfter = response.headers.get("retry-after") || "5";
        console.warn(`[Chatbot/Stream] Modal overloaded (${response.status}) — waiting ${retryAfter}s before retry...`);
        await sleep(parseInt(retryAfter) * 1000);
        if (attempt < timeouts.length - 1) {
          console.info("[Chatbot/Stream] Retrying Modal after queue clear...");
          continue;
        }
        console.error("[Chatbot/Stream] Modal still overloaded after retries — falling back to OpenCode.");
        return await streamOpenCodeFallback(request, picked.systemPrompt);
      }

      if (!response.ok || !response.body) {
        modalConsecFails++;
        modalLastFailTime = Date.now();
        console.warn(`[Chatbot/Stream] Modal attempt ${attempt + 1} failed: HTTP ${response.status}`);
        if (attempt < timeouts.length - 1) {
          console.info("[Chatbot/Stream] Retrying Modal...");
          await sleep(3000);
          continue;
        }
        console.error("[Chatbot/Stream] All Modal attempts failed — falling back to OpenCode.");
        return await streamOpenCodeFallback(request, picked.systemPrompt);
      }

      // SUCCESS
      modalConsecFails = 0;
      modalLastSuccess = Date.now();
      modalKeyValid = true;
      console.info(`[Chatbot/Stream] GLM-5.1 attempt ${attempt + 1} SUCCESS`);
      break; // Exit retry loop, proceed with stream
    }

    // If we got here without a response, something went wrong
    if (!response || !response.body) {
      console.error("[Chatbot/Stream] No Modal response after all attempts");
      return await streamOpenCodeFallback(request, picked.systemPrompt);
    }

    const upstream = response.body;
    const decoder = new TextDecoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.getReader();
        let sawContent = false;
        let buffer = "";
        let streamClosed = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || streamClosed) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // keep incomplete line

            for (const line of lines) {
              if (streamClosed) break;
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;
              if (!trimmed.startsWith("data: ")) continue;
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;
                // ✅ Forward ONLY `content`. Discard `reasoning_content` (chain-of-thought).
                if (delta.content) {
                  sawContent = true;
                  try { controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: delta.content }) + "\n\n")); } catch { streamClosed = true; break; }
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }

          // Flush any trailing buffered line
          if (!streamClosed) {
            const rest = buffer.trim();
            if (rest.startsWith("data: ") && rest.slice(6).trim() !== "[DONE]") {
              try {
                const parsed = JSON.parse(rest.slice(6).trim());
                const delta = parsed.choices?.[0]?.delta;
                if (delta && delta.content) {
                  sawContent = true;
                  try { controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: delta.content }) + "\n\n")); } catch { /* already closed */ }
                }
              } catch {
                // Skip malformed trailing chunk
              }
            }
          }
        } catch (e) {
          try { controller.error(e); } catch { /* already closed */ }
          return;
        } finally {
          try { reader.releaseLock(); } catch { /* already released */ }
        }

        // Modal produced only reasoning (or nothing usable) — recover via OpenCode then OpenRouter.
        if (!sawContent) {
          console.warn("[Chatbot/Stream] Modal returned no content (only reasoning) — trying OpenCode...");
          // Try OpenCode first
          const fb2 = await openCodeFallback(request.messages, picked.systemPrompt);
          if (fb2) {
            try { controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: fb2.reply }) + "\n\n")); } catch { /* controller already closed */ }
          } else {
            // Fall back to OpenRouter
            const fb = await openRouterFallback(request.messages, picked.systemPrompt, request.language);
            if (fb) {
              try { controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: fb.reply }) + "\n\n")); } catch { /* controller already closed */ }
            }
          }
        }

        try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* controller already closed */ }
        try { controller.close(); } catch { /* already closed */ }
      },
    });

    return { stream, model: picked.modelId };
  }

  // ─── OpenCode stream (DeepSeek V4 → MiMo → Big Pickle → North Mini Code) ───
  if (picked.provider === "opencode") {
    // Try each OpenCode model in cascade
    for (let i = 0; i < OPENCODE_MODELS.length; i++) {
      const modelId = OPENCODE_MODELS[i];
      opencodeCurrentModelIndex = i;

      const timeouts = [120000, 180000]; // 2min, 3min with backoff
      let response: Response | null = null;

      for (let attempt = 0; attempt < timeouts.length; attempt++) {
        const timeout = timeouts[attempt];
        try {
          response = await fetch(OPENCODE_ENDPOINT, {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + OPENCODE_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: modelId,
              messages: [
                { role: "system", content: picked.systemPrompt },
                ...request.messages.map(function(m) { return { role: m.role, content: m.content }; }),
              ],
              temperature: 0.7,
              max_tokens: 2048,
              stream: true,
            }),
            signal: AbortSignal.timeout(timeout),
          });
        } catch (e) {
          console.warn(`[Chatbot/Stream/OpenCode] ${modelId} attempt ${attempt + 1} threw:`, String(e));
          if (attempt < timeouts.length - 1) {
            await sleep(5000);
            continue;
          }
          break; // Try next model
        }

        // Check for overload — try next model
        if (response.status === 429 || response.status === 503) {
          const retryAfter = response.headers.get("retry-after") || "5";
          console.warn(`[Chatbot/Stream/OpenCode] ${modelId} overloaded (${response.status}) — trying next model...`);
          break; // Try next model
        }

        if (!response.ok || !response.body) {
          console.warn(`[Chatbot/Stream/OpenCode] ${modelId} attempt ${attempt + 1} failed: HTTP ${response.status}`);
          if (attempt < timeouts.length - 1) {
            await sleep(3000);
            continue;
          }
          break; // Try next model
        }

        // SUCCESS
        opencodeConsecFails = 0;
        opencodeLastSuccess = Date.now();
        opencodeKeyValid = true;
        console.info(`[Chatbot/Stream/OpenCode] ${modelId} SUCCESS`);

        const decoderOC = new TextDecoder();
        const transformStreamOC = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            try {
              const text = decoderOC.decode(chunk, { stream: true });
              const lines = text.split("\n");
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "data: [DONE]") continue;
                if (!trimmed.startsWith("data: ")) continue;
                try {
                  const parsed = JSON.parse(trimmed.slice(6));
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta && delta.content) {
                    try { controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: delta.content }) + "\n\n")); } catch { /* closed */ }
                  }
                } catch { /* skip */ }
              }
            } catch { /* decode error */ }
          },
          flush(controller) {
            try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* closed */ }
            try { controller.terminate(); } catch { /* terminated */ }
          },
        });
        return { stream: response!.body!.pipeThrough(transformStreamOC), model: modelId };
      }

      // Model exhausted — try next
      opencodeConsecFails++;
      opencodeLastFailTime = Date.now();
      console.warn(`[Chatbot/Stream/OpenCode] ${modelId} exhausted — trying next model...`);
    }

    // All OpenCode models failed
    console.error("[Chatbot/Stream] All OpenCode models exhausted — falling back to OpenRouter.");
    return await streamOpenRouterFallback(request, picked.systemPrompt);
  }

  // ─── OpenRouter stream ───
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      body: JSON.stringify({
        model: picked.modelId,
        messages: [
          { role: "system", content: picked.systemPrompt },
          ...request.messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      modelFailCount[picked.modelId] = (modelFailCount[picked.modelId] || 0) + 1;
      return {
        error: request.language === "ar"
          ? "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى."
          : "Sorry, an error occurred. Please try again.",
      };
    }

    const decoder = new TextDecoder();
    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        try {
          const text = decoder.decode(chunk, { stream: true });
          const lines = text.split("\n");

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta;
              if (delta && delta.content) {
                try {
                  controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: delta.content }) + "\n\n"));
                } catch { /* stream closed */ }
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        } catch { /* decode error - skip */ }
      },
      flush(controller) {
        try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* already closed */ }
        try { controller.terminate(); } catch { /* already terminated */ }
      },
    });

    const stream = response.body.pipeThrough(transformStream);
    return { stream, model: picked.modelId };
  } catch {
    modelFailCount[picked.modelId] = (modelFailCount[picked.modelId] || 0) + 1;
    return {
      error: request.language === "ar"
        ? "تعذر الاتصال بالخدمة. يرجى المحاولة مرة أخرى."
        : "Could not connect to the service. Please try again.",
    };
  }
}

/**
 * Non-streaming OpenCode fallback — try all OpenCode models in cascade.
 */
async function openCodeFallback(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<{ reply: string; model: string } | null> {
  for (let i = 0; i < OPENCODE_MODELS.length; i++) {
    const modelId = OPENCODE_MODELS[i];
    const result = await tryOpenCode(messages, systemPrompt, modelId, 120000);
    if (result) return result;
  }
  return null;
}

/**
 * If a Modal stream fails, try OpenCode fallback,
 * then emit as a single SSE text chunk so the client sees one clean reply.
 */
async function streamOpenCodeFallback(
  request: { messages: { role: string; content: string }[]; language?: string },
  systemPrompt: string
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const ocResult = await openCodeFallback(request.messages, systemPrompt);
  if (ocResult) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: ocResult.reply }) + "\n\n"));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* controller already closed */ }
      },
    });
    return { stream, model: ocResult.model };
  }

  // OpenCode also failed — try OpenRouter
  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language);
  if (!orResult) {
    return {
      error: request.language === "ar"
        ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
        : "All AI models are temporarily busy. Please try again in a few seconds.",
    };
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: orResult.reply }) + "\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch { /* controller already closed */ }
    },
  });
  return { stream, model: orResult.model };
}

/**
 * If a Modal stream fails, fall back to a NON-streaming OpenRouter response,
 * then emit it as a single SSE text chunk so the client sees one clean reply.
 */
async function streamOpenRouterFallback(
  request: { messages: { role: string; content: string }[]; language?: string },
  systemPrompt: string
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language);
  if (!orResult) {
    return {
      error: request.language === "ar"
        ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
        : "All AI models are temporarily busy. Please try again in a few seconds.",
    };
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: orResult.reply }) + "\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch { /* controller already closed */ }
    },
  });
  return { stream, model: orResult.model };
}

/**
 * Get stats about provider/model usage (for debugging/monitoring)
 */
export function getChatbotStats() {
  return {
    tier1: {
      provider: "modal",
      model: MODAL_MODEL,
      configured: !!MODAL_API_KEY,
      keyValid: modalKeyValid,
      consecFails: modalConsecFails,
      lastSuccessAgo: modalLastSuccess ? Math.round((Date.now() - modalLastSuccess) / 1000) + "s ago" : "never",
      available: modalIsAvailable(),
    },
    tier2: {
      provider: "opencode",
      models: OPENCODE_MODELS,
      currentModel: OPENCODE_MODELS[opencodeCurrentModelIndex] || OPENCODE_MODELS[0],
      configured: !!OPENCODE_API_KEY,
      keyValid: opencodeKeyValid,
      consecFails: opencodeConsecFails,
      lastSuccessAgo: opencodeLastSuccess ? Math.round((Date.now() - opencodeLastSuccess) / 1000) + "s ago" : "never",
      available: opencodeIsAvailable(),
    },
    tier3: {
      provider: "openrouter",
      configured: !!OPENROUTER_API_KEY,
      keyValid: openrouterKeyValid,
      totalModels: AI_MODELS.length,
      lastWorkingModel: lastWorkingModel,
      lastWorkingTimeAgo: lastWorkingTime ? Math.round((Date.now() - lastWorkingTime) / 1000) + "s ago" : "never",
      modelSuccessCounts: modelSuccessCount,
      modelFailCounts: modelFailCount,
    },
  };
}
