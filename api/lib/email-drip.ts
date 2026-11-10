/**
 * EDUCATIONAL EMAIL DRIP — the retention engine
 *
 * Three emails, all bilingual (Arabic primary), all idempotent:
 *   1. welcome            — immediately after registration (event-driven)
 *   2. nudge_48h          — registered 48h+ ago but never opened a lesson
 *                           (swept by the background scheduler)
 *   3. congrats:{courseId}— completed ALL lessons of a course (event-driven
 *                           from recalcEnrollmentProgress) + asks for a review
 *
 * Idempotency: emailDripLog has UNIQUE(userId, kind). We INSERT IGNORE first;
 * insertId > 0 means "we own the send slot". If the actual send fails we
 * DELETE our slot row so the next sweep retries — no double sends, no lost
 * sends. Users without an email address are simply skipped (username-only
 * registrations have nothing to write to).
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { users, emailDripLog, courses } from "@db/schema";
import { sendEmail } from "./email";
import { env } from "./env";
import { logger } from "./logger.js";

/** Same shape as email.ts's internal EmailMessage (not exported there). */
interface DripEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// ─── Pure template builders (unit-testable) ─────────────────────────────────

export type DripLang = "ar" | "en";

export function formatVideoPosition(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function welcomeEmailBody(name: string, lang: DripLang): { subject: string; html: string; text: string } {
  const display = name || (lang === "ar" ? "صديقنا" : "friend");
  if (lang === "ar") {
    return {
      subject: `أهلاً بيك في منصة الباز يا ${display} 🚀`,
      html: `<p>أهلاً ${display}،</p>
<p>حلو إنك انضمّت لمنصة الباز — منصة تدريب مهندس القوى الكهربية عربي بالكامل.</p>
<p><b>أول خطوة مقترحة:</b> افتح أول درس من كورس ETAP وشوف أسلوب الشرح بنفسك — من غير أي التزام.</p>
<p><a href="${env.FRONTEND_URL}/courses">ابدأ من صفحة الكورسات</a></p>
<p>وفي أي وقت، لو محتاج مساعدة الفريق التقني جاهز ليك من جوه المنصة.</p>
<p>— م. أحمد الباز</p>`,
      text: `أهلاً ${display}،\nحلو إنك انضمّت لمنصة الباز.\nابدأ من أول درس في كورس ETAP: ${env.FRONTEND_URL}/courses\n— م. أحمد الباز`,
    };
  }
  return {
    subject: `Welcome to Elbaz Platform, ${display} 🚀`,
    html: `<p>Hi ${display},</p>
<p>Glad you joined Elbaz Platform — Arabic-first power-engineering training.</p>
<p><b>Suggested first step:</b> open the first ETAP lesson and see the teaching style for yourself — no commitment.</p>
<p><a href="${env.FRONTEND_URL}/courses">Start from the courses page</a></p>
<p>— Eng. Ahmed Elbaz</p>`,
    text: `Hi ${display},\nGlad you joined Elbaz Platform.\nStart with the first ETAP lesson: ${env.FRONTEND_URL}/courses\n— Eng. Ahmed Elbaz`,
  };
}

export function nudgeEmailBody(name: string, lang: DripLang): { subject: string; html: string; text: string } {
  const display = name || (lang === "ar" ? "صديقنا" : "friend");
  if (lang === "ar") {
    return {
      subject: `حسابك فات يومين من غير ما تبدأ يا ${display} — الدرس الأول ساعة بس ⏱️`,
      html: `<p>أهلاً ${display}،</p>
<p>حسابك اتعمل من يومين بس لسه ما فتحت أي درس. أعرف — الجدول زحمة.</p>
<p>اقتراح عملي: ابدأ <b>بأول درس بس</b> (ساعة واحدة تقريباً) واحسم قرارك بعدها. أول درس هو اللي بيوصلك بأسلوب الشرح وأسلوب الأمثلة.</p>
<p><a href="${env.FRONTEND_URL}/courses">افتح الدرس الأول الآن</a></p>
<p>لو في أي حاجة واقفة معاك تقنياً، اكتب للدعم من جوه المنصة وهنرد عليك.</p>
<p>— م. أحمد الباز</p>`,
      text: `أهلاً ${display}،\nحسابك من يومين ولسه ما فتحت أي درس.\nابدأ بأول درس (ساعة واحدة): ${env.FRONTEND_URL}/courses\n— م. أحمد الباز`,
    };
  }
  return {
    subject: `Your account is 2 days old with zero lessons, ${display} — start with lesson 1 ⏱️`,
    html: `<p>Hi ${display},</p>
<p>Your account was created two days ago but no lesson has been opened yet. We get it — schedules are busy.</p>
<p>Practical suggestion: watch <b>lesson 1 only</b> (about an hour), then decide. The first lesson tells you everything about the teaching style.</p>
<p><a href="${env.FRONTEND_URL}/courses">Open lesson 1 now</a></p>
<p>— Eng. Ahmed Elbaz</p>`,
    text: `Hi ${display},\nYour account is 2 days old with no lessons watched.\nStart with lesson 1: ${env.FRONTEND_URL}/courses\n— Eng. Ahmed Elbaz`,
  };
}

export function congratsEmailBody(
  name: string,
  courseTitle: string,
  courseSlug: string,
  certificateUrl: string,
  lang: DripLang,
): { subject: string; html: string; text: string } {
  const display = name || (lang === "ar" ? "بطل" : "champion");
  if (lang === "ar") {
    return {
      subject: `🎉 مبروك يا ${display} — أكملت "${courseTitle}" بالكامل!`,
      html: `<p>مبروك ${display} 🎉</p>
<p>خلّصت كل دروس <b>${courseTitle}</b> — ده مجهود حقيقي مش أي حد بيعمله.</p>
<p><b>خطوتين بعد الختان:</b></p>
<ol>
<li>اطلب <a href="${certificateUrl}">شهادتك الموثّقة</a> من لوحتك — تصلح تتحط على LinkedIn فوراً.</li>
<li>اكتب تقييم صريح للكورس — رأيك بيساعد زمايلك المهندسين يقرروا، والتقييمات الموثقة بشهادة بتظهر على صفحة المنصة الرئيسية.</li>
</ol>
<p><a href="${env.FRONTEND_URL}/courses/${courseSlug}">افتح صفحة الكورس واكتب تقييمك</a></p>
<p>— م. أحمد الباز</p>`,
      text: `مبروك ${display}!\nأكملت ${courseTitle} بالكامل.\nاطلب شهادتك: ${certificateUrl}\nواكتب تقييمك: ${env.FRONTEND_URL}/courses/${courseSlug}\n— م. أحمد الباز`,
    };
  }
  return {
    subject: `🎉 Congratulations ${display} — you completed "${courseTitle}"!`,
    html: `<p>Congratulations ${display} 🎉</p>
<p>You finished every lesson of <b>${courseTitle}</b> — that is real commitment.</p>
<p><b>Two next steps:</b></p>
<ol>
<li>Claim your <a href="${certificateUrl}">verifiable certificate</a> from your dashboard — LinkedIn-ready.</li>
<li>Write an honest course review — it helps fellow engineers decide, and certificate-verified reviews appear on the home page.</li>
</ol>
<p><a href="${env.FRONTEND_URL}/courses/${courseSlug}">Open the course page and write your review</a></p>
<p>— Eng. Ahmed Elbaz</p>`,
    text: `Congratulations ${display}!\nYou completed ${courseTitle}.\nClaim your certificate: ${certificateUrl}\nWrite a review: ${env.FRONTEND_URL}/courses/${courseSlug}\n— Eng. Ahmed Elbaz`,
  };
}

// ─── Idempotent send core ───────────────────────────────────────────────────

async function sendDripEmail(userId: number, kind: string, message: DripEmailMessage): Promise<boolean> {
  const db = getDb();
  // INSERT IGNORE claims the (userId, kind) slot atomically. affectedRows=1
  // means "we own the send"; 0 means an email of this kind was already sent
  // to this user (idempotency guard).
  const claimed = await db.execute(
    sql`INSERT IGNORE INTO emailDripLog (\`userId\`, \`kind\`) VALUES (${userId}, ${kind})`,
  );
  const affected = Number((claimed as unknown as { affectedRows?: number })?.affectedRows ?? 0);
  if (affected === 0) {
    return false; // already sent before — skip silently
  }

  // Recover the slot row id so a failed send can release it for retry.
  const [slotRow] = await db
    .select({ id: emailDripLog.id })
    .from(emailDripLog)
    .where(and(eq(emailDripLog.userId, userId), eq(emailDripLog.kind, kind)))
    .limit(1);
  const slotId = slotRow?.id;

  const ok = await sendEmail(message);
  if (!ok && slotId !== undefined) {
    // Release the slot so the next sweep/event retries instead of losing the email.
    await db.delete(emailDripLog).where(eq(emailDripLog.id, slotId)).catch(() => undefined);
  }
  return ok;
}

// ─── 1. Welcome (event-driven from register) ────────────────────────────────

export async function maybeSendWelcomeEmail(
  userId: number,
  username: string,
  email: string,
  name: string,
): Promise<boolean> {
  try {
    const db = getDb();
    const [user] = await db
      .select({ preferredLanguage: users.preferredLanguage })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const lang: DripLang = (user?.preferredLanguage === "en" ? "en" : "ar");
    const body = welcomeEmailBody(name || username, lang);
    return await sendDripEmail(userId, "welcome", {
      to: email,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
  } catch (err) {
    logger.warn("[EmailDrip] welcome send failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── 2. Completion congrats (event-driven from progress engine) ─────────────

export async function maybeSendCompletionCongrats(userId: number, courseId: number): Promise<boolean> {
  try {
    const db = getDb();
    const [user] = await db
      .select({ username: users.username, name: users.name, email: users.email, preferredLanguage: users.preferredLanguage })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.email) return false;
    const [course] = await db
      .select({ slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    if (!course) return false;

    const lang: DripLang = (user.preferredLanguage === "en" ? "en" : "ar");
    const courseTitle = lang === "ar" ? course.titleAr : course.titleEn;
    const body = congratsEmailBody(
      user.name || user.username,
      courseTitle,
      course.slug,
      `${env.FRONTEND_URL}/dashboard`,
      lang,
    );
    return await sendDripEmail(userId, `congrats:${courseId}`, {
      to: user.email,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });
  } catch (err) {
    logger.warn("[EmailDrip] congrats send failed", {
      userId,
      courseId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── 3. 48h nudge sweep (scheduler-driven) ──────────────────────────────────

interface NudgeCandidate {
  id: number;
  username: string;
  name: string | null;
  email: string;
  preferredLanguage: string;
}

/** SQL shape lives here so the sweep is one round-trip. */
const NUDGE_SQL = `
  SELECT u.id, u.username, u.name, u.email, u.preferredLanguage
  FROM users u
  WHERE u.role = 'user'
    AND u.email IS NOT NULL
    AND u.createdAt <= NOW() - INTERVAL 48 HOUR
    AND u.createdAt >= NOW() - INTERVAL 45 DAY
    AND NOT EXISTS (SELECT 1 FROM lessonProgress lp WHERE lp.userId = u.id)
    AND NOT EXISTS (SELECT 1 FROM emailDripLog d WHERE d.userId = u.id AND d.kind = 'nudge_48h')
  LIMIT 50
`;

export async function runNudgeSweep(): Promise<{ checked: number; sent: number }> {
  const db = getDb();
  const [rows] = (await db.execute(sql`${sql.raw(NUDGE_SQL)}`)) as unknown as [NudgeCandidate[], unknown];
  const candidates = Array.isArray(rows) ? rows : [];

  let sent = 0;
  for (const candidate of candidates) {
    try {
      const lang: DripLang = (candidate.preferredLanguage === "en" ? "en" : "ar");
      const body = nudgeEmailBody(candidate.name || candidate.username, lang);
      const ok = await sendDripEmail(candidate.id, "nudge_48h", {
        to: candidate.email,
        subject: body.subject,
        html: body.html,
        text: body.text,
      });
      if (ok) sent++;
    } catch (err) {
      logger.warn("[EmailDrip] nudge send failed", {
        userId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (candidates.length > 0 || sent > 0) {
    logger.info("[EmailDrip] nudge sweep done", { checked: candidates.length, sent });
  }
  return { checked: candidates.length, sent };
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

let sweepRunning = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background drip scheduler (called once from boot.ts).
 * Runs the nudge sweep every 6 hours, first pass ~90s after boot so the
 * server finishes warming up (DB, Redis, providers) before touching email.
 */
export function startEmailDripScheduler(): void {
  if (schedulerTimer) return; // already started (HMR / multi-require safety)
  const run = async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      await runNudgeSweep();
    } catch (err) {
      logger.warn("[EmailDrip] sweep error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      sweepRunning = false;
    }
  };
  setTimeout(() => { void run(); }, 90_000);
  schedulerTimer = setInterval(() => { void run(); }, 6 * 3600 * 1000);
  logger.info("[EmailDrip] scheduler started (every 6h, first pass in 90s)");
}
