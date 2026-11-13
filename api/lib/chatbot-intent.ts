/**
 * CHATBOT INTENT DETECTION — pure, dependency-free token-budget module.
 *
 * ✅ TOKEN OPTIMIZATION LAYER (prompt v3.6.0): the platform pays prompt tokens
 * on EVERY chat message. Three payloads used to be injected unconditionally:
 *   • the 40-course catalog block (~8.1k chars ≈ 2k+ tokens) — even on pure
 *     ETAP calculation questions where the model never quotes a price;
 *   • the OpenRouter web plugin (~1-3k tokens of injected search results per
 *     attempt) — even on questions that cannot need live web data;
 *   • full-length assistant turns in history (up to 8k chars EACH — the
 *     client ships the last 20 messages verbatim).
 *
 * This module owns the INTENT predicates that gate those payloads. Design
 * contract (quality is non-negotiable):
 *   • FALSE POSITIVES are always SAFE — the payload is injected exactly as
 *     before (current behavior, zero quality delta, small token cost).
 *   • FALSE NEGATIVES are the only danger — so every trigger list errs
 *     GENEROUS: course questions (prices, certificates, payment, levels,
 *     recommendations, even multi-turn references) always match. Multi-turn
 *     stickiness is handled by scanning recent user history, not just the
 *     latest message.
 *
 * Normalization reuses SkillNet's canonical Arabic-aware form so "كورس" and
 * "كورسات" or "دورة"/"دورات" behave identically everywhere.
 */

import { normalizeSignalText } from "./chatbot-skillnet.js";

// ─── Course/platform intent (catalog gating) ────────────────────────────────

/**
 * Generous triggers for catalog injection. Arabic forms are written against
 * the NORMALIZED text (ة→ه, ى→ي, أ→ا, harakat stripped), so "كورسة" matches
 * "كورسه" and "شهادة" matches "شهاده". Latin tokens match case-insensitively;
 * short tokens use the SkillNet word-boundary matcher to avoid substring
 * accidents ("pay" inside "payload").
 */
const COURSE_INTENT_KEYWORDS: string[] = [
  // Courses & training
  "كورس", "كورسات", "دوره", "دورات", "تدريب", "تدريبات", "برنامج تعليمي",
  "course", "courses", "training", "curriculum",
  // Prices & money
  "سعر", "اسعار", "بكام", "price", "prices", "pricing", "cost",
  "تكلفه", "مصاريف", "fee", "fees",
  "مجاني", "مجانيه", "مجانا", "مدفوع", "مدفوعه", "اشتراك", "free", "premium",
  "دفع", "payment", "pay", "paymob", "فيزا", "visa", "instapay", "انستاباي",
  "فودافون كاش", "محفظه", "رصيد", "جنيه", "dollar", "دولار", "egp",
  "خصم", "discount", "كوبون", "coupon", "عرض", "عروض", "offer", "offers",
  // Certificates
  "شهاده", "شهادات", "certificate", "certificates", "certification",
  // Platform / purchase / enrollment
  "منصه", "platform", "موقع", "سايت", "website", "تسجيل", "register",
  "enroll", "enrollment", "اشتري", "شراء", "buy", "purchase",
  // Levels, duration, recommendations
  "مستوي", "مستويات", "level", "levels", "مبتدي", "beginner", "متقدم",
  "advanced", "مدة", "duration", "ساعات", "hours",
  "انصح", "توصيه", "recommend", "اقترح", "suggest", "افضل", "best",
  "اتعلم", "learn", "ابدا تعلم", "ازاي اتعلم", "تعلم",
];

const WEB_INTENT_KEYWORDS: string[] = [
  // Versions & releases
  "نسخه", "اصدار", "version", "release", "update", "تحديث", "patch",
  "new", "latest", "احدث", "اخر اصدار", "جديد",
  // Year tokens — current-info questions
  "2024", "2025", "2026", "2027",
  // Pricing/news/licensing of EXTERNAL software (the platform's own course
  // prices come from the catalog, not the web)
  "license", "ترخيص", "رخصه", "subscription", "اشتراك سنوي", "اتصال",
  "news", "اخبار", "announcement", "اعلان",
  "compatib", "توافق", "متوافق", "يتوافق", "system requirements", "متطلبات التشغيل",
];

/** Word-boundary matcher for short Latin tokens (copied from SkillNet's
 *  keywordMatcher semantics so both layers agree on what a "hit" is). */
function intentMatcher(keyword: string): (s: string) => boolean {
  const kw = keyword.trim();
  if (/^[a-z0-9*+#.]{1,4}$/.test(kw)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
    return (s) => re.test(s);
  }
  return (s) => s.includes(kw);
}

const COURSE_MATCHERS = COURSE_INTENT_KEYWORDS.map(intentMatcher);
const WEB_MATCHERS = WEB_INTENT_KEYWORDS.map(intentMatcher);

/**
 * TRUE when the text plausibly touches courses/prices/platform/purchase —
 * the catalog must ride along. Normalizes internally; safe to feed raw text.
 */
export function hasCourseIntent(text: string): boolean {
  const normalized = normalizeSignalText(text);
  if (normalized.length < 2) return false;
  return COURSE_MATCHERS.some((match) => match(normalized));
}

/**
 * TRUE when the message plausibly needs live web grounding (versions, prices
 * of external software, news, release years). Everything else runs
 * plugin-free — identical answer quality, no injected search-result tokens.
 */
export function hasWebIntent(text: string): boolean {
  const normalized = normalizeSignalText(text);
  if (normalized.length < 2) return false;
  return WEB_MATCHERS.some((match) => match(normalized));
}

/** Structural typing mirror of the chat message shape (no import cycle). */
export interface IntentScanMessage {
  role?: unknown;
  content?: unknown;
}

function messageText(m: IntentScanMessage | null | undefined): string {
  if (!m || m.role !== "user") return "";
  const content = m.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * Course intent is STICKY across a conversation: a user who asked about
 * courses two messages ago and now says "طيب والأخيرة دي؟" still needs the
 * catalog. Scans the LAST `window` user messages and returns true if ANY of
 * them matches — false negatives here would degrade answers, so the window
 * is generous (default 8 ≈ the full client-shipped history of 20 messages
 * covers ~10 turns; 8 user turns is effectively the whole visible context).
 */
export function courseIntentFromMessages(messages: IntentScanMessage[] | null | undefined, window = 8): boolean {
  if (!Array.isArray(messages)) return false;
  const userTexts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && userTexts.length < window; i--) {
    const text = messageText(messages[i]);
    if (text.trim()) userTexts.push(text);
  }
  return userTexts.some((t) => hasCourseIntent(t));
}

/** Same scan for web intent (only the LATEST message matters for grounding —
 *  stale web needs do not justify injected search tokens on a new question). */
export function webIntentFromMessages(messages: IntentScanMessage[] | null | undefined): boolean {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i]);
    if (text.trim()) return hasWebIntent(text);
  }
  return false;
}

// ─── Catalog lite slicing (pure) ────────────────────────────────────────────

/**
 * Sample of the full catalog text: the first `maxCourses` course lines
 * (the DB query orders by featured → sortOrder, so the slice IS the featured
 * head). Returns "" for empty input — the caller falls back to the standard
 * block text.
 */
export function sliceCatalogLite(fullCatalog: string, maxCourses = 8): string {
  if (!fullCatalog || !fullCatalog.trim()) return "";
  const lines = fullCatalog.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length <= maxCourses) return fullCatalog;
  return lines.slice(0, maxCourses).join("\n");
}
