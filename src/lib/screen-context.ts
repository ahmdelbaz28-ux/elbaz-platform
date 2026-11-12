/**
 * SCREEN CONTEXT FOR THE CHATBOT — live "what is on the user's screen" state.
 *
 * Owner requirement (2026-11): when a user asks the chatbot anything about the
 * site, the answer must be grounded in the user's CURRENT screen — the open
 * page, the entity displayed on it (course / lesson / article), and the recent
 * navigation trail — answered precisely, never guessed.
 *
 * How it works (three moving parts):
 *   1. ROUTE MAP — every app route resolves to the exact bilingual page name
 *      the UI itself shows in the navbar (no invented labels). ChatBot calls
 *      describeRoute() on every navigation.
 *   2. ENTITY REGISTRATION — pages that display a specific object (CourseDetail
 *      → course + open lesson, ArticleDetail → article) register that object's
 *      real title via registerScreenDetails()/useScreenDetails(); the
 *      registration clears on unmount so a stale course title can never leak
 *      onto another page's snapshot.
 *   3. SNAPSHOT — buildChatPageContext() composes the whole picture at
 *      send-time (path, page name, entity title, trail, device, auth role).
 *      ChatBot embeds it into every chat request; the server validates it
 *      again (api/lib/chatbot-screen.ts) before it may reach the model prompt.
 *
 * Everything here is session-only (module state, never persisted) and
 * PUBLIC-SAFE by contract: pages must only register titles that are already
 * visible on the screen. This module must stay importable in a bare Node test
 * environment — every browser API access is guarded (React itself is
 * environment-agnostic, so the only guarded things are window/document).
 */

import { useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScreenLang = "ar" | "en";
export type ScreenDevice = "mobile" | "tablet" | "desktop";
export type ScreenAuth = "guest" | "user" | "admin";

/** The object a page currently displays (registered by the page itself). */
export interface ScreenDetails {
  /** Real on-screen title of the displayed entity (course/article/lesson). */
  title?: string;
  /** Entity kind — keeps the block self-describing for the model. */
  kind?: "course" | "lesson" | "article" | "certificate" | "quiz" | "other";
  /** One short extra line the page may add (e.g. "الدرس 3 من 12"). */
  meta?: string;
}

/** Wire shape sent as `pageContext` with every chat request. */
export interface ChatPageContext {
  path: string;
  page: string;
  title?: string;
  details?: string;
  trail?: string[];
  device: ScreenDevice;
  auth: ScreenAuth;
  lang: ScreenLang;
}

// ─── Sanitization (client-side mirror of the server caps — defense in depth) ─

const CAPS = {
  path: 200,
  page: 80,
  title: 150,
  details: 300,
  meta: 120,
  trailEntries: 6,
  trailEntry: 120,
} as const;

/** Strip control chars + collapse whitespace — no prompt-format forgery. */
export function sanitizeScreenText(raw: unknown, cap: number): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/"{3,}/g, "”") // the prompt block uses """ delimiters — never let data forge them
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, cap);
}

// ─── Route map — names match the navbar labels EXACTLY ──────────────────────

interface RouteEntry {
  re: RegExp;
  ar: string;
  en: string;
}

/**
 * Ordered list — more specific patterns first (e.g. /courses/:slug before the
 * generic catch-all). Names are the SAME strings the navbar renders
 * (Navbar.tsx) so the model's page names always match what the user sees.
 */
export const ROUTE_TABLE: readonly RouteEntry[] = [
  { re: /^\/$/, ar: "الرئيسية", en: "Home" },
  { re: /^\/courses\/[^/]+$/, ar: "صفحة الكورس", en: "Course page" },
  { re: /^\/courses$/, ar: "الكورسات", en: "Courses" },
  { re: /^\/articles\/[^/]+$/, ar: "صفحة المقال", en: "Article page" },
  { re: /^\/articles$/, ar: "المقالات", en: "Articles" },
  { re: /^\/references$/, ar: "المراجع", en: "References" },
  { re: /^\/faq$/, ar: "الأسئلة الشائعة", en: "FAQ" },
  { re: /^\/wishlist$/, ar: "المفضلة", en: "Wishlist" },
  { re: /^\/journey$/, ar: "رحلتي", en: "My Journey" },
  { re: /^\/dashboard$/, ar: "لوحتي", en: "Dashboard" },
  { re: /^\/profile$/, ar: "الملف الشخصي", en: "Profile" },
  { re: /^\/support$/, ar: "الدعم الفني", en: "Support" },
  { re: /^\/documents$/, ar: "المستندات", en: "Documents" },
  { re: /^\/admin$/, ar: "لوحة التحكم", en: "Admin Panel" },
  { re: /^\/certificate\/[^/]+$/, ar: "صفحة الشهادة", en: "Certificate page" },
  { re: /^\/verify(\/[^/]+)?$/, ar: "التحقق من الشهادات", en: "Certificate verification" },
  { re: /^\/login$/, ar: "تسجيل الدخول", en: "Login" },
  { re: /^\/register$/, ar: "إنشاء حساب", en: "Register" },
  { re: /^\/forgot-password$/, ar: "استعادة كلمة المرور", en: "Forgot password" },
  { re: /^\/reset-password$/, ar: "إعادة تعيين كلمة المرور", en: "Reset password" },
  { re: /^\/verify-email$/, ar: "تأكيد البريد الإلكتروني", en: "Email verification" },
  { re: /^\/terms$/, ar: "شروط الاستخدام", en: "Terms of Service" },
  { re: /^\/privacy$/, ar: "سياسة الخصوصية", en: "Privacy Policy" },
  { re: /^\/refund$/, ar: "سياسة الاسترداد", en: "Refund Policy" },
];

/** Resolve a pathname to the exact page name shown in the site UI. */
export function describeRoute(pathname: string, lang: ScreenLang): string {
  const path = sanitizeScreenText(pathname, CAPS.path);
  for (const entry of ROUTE_TABLE) {
    if (entry.re.test(path)) return lang === "ar" ? entry.ar : entry.en;
  }
  return lang === "ar" ? "صفحة غير معروفة (404)" : "Unknown page (404)";
}

// ─── Entity registration (module store — session only, never persisted) ─────

let screenDetails: ScreenDetails | null = null;

/** Register (or clear with null) the entity currently displayed by a page. */
export function registerScreenDetails(details: ScreenDetails | null): void {
  if (!details) {
    screenDetails = null;
    return;
  }
  const title = sanitizeScreenText(details.title, CAPS.title);
  const meta = sanitizeScreenText(details.meta, CAPS.meta);
  const kind = details.kind && ["course", "lesson", "article", "certificate", "quiz", "other"].includes(details.kind)
    ? details.kind
    : "other";
  // Nothing usable registered → store null so the snapshot stays honest.
  if (!title && !meta) {
    screenDetails = null;
    return;
  }
  screenDetails = {
    kind,
    ...(title ? { title } : {}),
    ...(meta ? { meta } : {}),
  };
}

export function getScreenDetails(): ScreenDetails | null {
  return screenDetails;
}

/**
 * React hook for pages: registers the displayed entity while mounted and
 * clears it on unmount (so navigating away never leaves a stale title behind).
 * Re-registers automatically when the serialized details change.
 */
export function useScreenDetails(details: ScreenDetails | null): void {
  const key = details
    ? `${sanitizeScreenText(details.title, CAPS.title)}|${sanitizeScreenText(details.meta, CAPS.meta)}|${details.kind ?? ""}`
    : "";
  useEffect(() => {
    registerScreenDetails(details);
    return () => registerScreenDetails(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ─── Navigation trail (recent pages, newest last, consecutive dedup) ────────

const trail: string[] = [];

/** Called by ChatBot on every location change. */
export function pushTrail(pathname: string): void {
  const path = sanitizeScreenText(pathname, CAPS.trailEntry);
  if (!path) return;
  if (trail[trail.length - 1] === path) return; // same page — no duplicate
  trail.push(path);
  while (trail.length > CAPS.trailEntries) trail.shift();
}

export function getTrail(): readonly string[] {
  return [...trail];
}

/** Test-only reset of all module state. */
export function resetScreenContextForTests(): void {
  screenDetails = null;
  trail.length = 0;
}

// ─── UI state ───────────────────────────────────────────────────────────────

export function getDeviceClass(): ScreenDevice {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(max-width: 640px)").matches) return "mobile";
      if (window.matchMedia("(max-width: 1024px)").matches) return "tablet";
    } catch {
      // fall through to desktop
    }
  }
  return "desktop";
}

// ─── Snapshot composition (send-time, fresh every message) ──────────────────

export function buildChatPageContext(input: {
  pathname: string;
  lang: ScreenLang;
  auth: ScreenAuth;
}): ChatPageContext {
  const path = sanitizeScreenText(input.pathname, CAPS.path);
  const page = describeRoute(path, input.lang);
  const details = getScreenDetails();
  const trailPaths = getTrail()
    .slice(0, CAPS.trailEntries)
    .map((p) => sanitizeScreenText(p, CAPS.trailEntry))
    .filter(Boolean);

  return {
    path,
    page: sanitizeScreenText(page, CAPS.page),
    ...(details?.title ? { title: details.title } : {}),
    ...(details
      ? {
          details: [
            details.kind && details.kind !== "other" ? `kind=${details.kind}` : "",
            details.meta ? details.meta : "",
          ]
            .filter(Boolean)
            .join(" — ")
            .slice(0, CAPS.details) || undefined,
        }
      : {}),
    ...(trailPaths.length > 1 || (trailPaths.length === 1 && trailPaths[0] !== path)
      ? { trail: trailPaths.slice(-CAPS.trailEntries) }
      : {}),
    device: getDeviceClass(),
    auth: input.auth,
    lang: input.lang,
  };
}
