import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * REGRESSION GUARD — audit run-2 fixes (cf-security-audit-skill findings,
 * scoped run: delta f34855f..90c0124 + carried prior-run records).
 *
 * Source-level invariants the run-2 audit established. Each had either a
 * missing enforcement site or a semantics trap that a unit test cannot invoke
 * without a live DB/browser, so the SOURCE is pinned (same pattern as
 * audit-run1-fixes.test.ts / sessions-router.sql.test.ts):
 *
 * 1. settings publicQuery partition — anonymous settings reads must serve ONLY
 *    PUBLIC_SETTINGS_SECTIONS; adminRecovery (bcrypt backupHash parking),
 *    youtubeSync and youtubeWatch must never cross the anonymous boundary, in
 *    getAll (row filter) or getSection (input refine BEFORE the cache lookup).
 * 2. SafeUser projection — the tRPC context must carry ONLY the curated
 *    7-field Pick<> (no passwordHash, no totpSecret, no OTP/token hashes), and
 *    BOTH identity endpoints must enforce the shared AuthMeOutput .output()
 *    runtime strip.
 * 3. quiz publish gate — quiz.byLesson and quiz.submit lesson lookups must
 *    apply the same lessons.isPublished predicate the sibling surfaces enforce.
 * 4. progress publish symmetry — BOTH progress completed-side queries and the
 *    certificate avgScore query must carry eq(lessons.isPublished, true) to
 *    match the total side.
 * 5. course-watching two-level gate — lessonVideo/markWatched/heartbeat must
 *    join courses and require courses.isPublished (lesson-level alone kept
 *    withdrawn courses playable).
 * 6. promo throttle completion — /apply and /apply/internal join /validate on
 *    the cap-as-capacity per-window limiter; NO promo surface may pass an
 *    intended window cap as rateLimit()'s consume cost.
 * 7. Google redirect identity-flip purge — the OAuth callback must set the
 *    elbaz_identity_switch marker cookie and the SPA boot must purge
 *    ELBAZ_QUERY_CACHE pre-render when it is seen.
 * 8. yt-sync replay lane (STEP 1) — the worker cron signs body+'.'+ts with
 *    x-sync-ts; the ingest body-only fallback logs a deprecation warning on
 *    every accept (STEP 2 removal commit will hard-401 it).
 */
describe("audit run-2 (Cloudflare security-audit-skill) fix regression guards", () => {
  const src = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  const settingsSource = src("./settings-router.ts");
  const contextSource = src("./context.ts");
  const localAuthSource = src("./local-auth-router.ts");
  const authRouterSource = src("./auth-router.ts");
  const quizSource = src("./quiz-router.ts");
  const progressSource = src("./lib/progress.ts");
  const certificateSource = src("./certificate-router.ts");
  const watchingSource = src("./course-watching.ts");
  const promoSource = src("./promo-router.ts");
  const cookiesSource = src("./lib/cookies.ts");
  const googleAuthSource = src("./google-auth-router.ts");
  const mainSource = src("../src/main.tsx");
  const trpcProviderSource = src("../src/providers/trpc.tsx");
  const workerSource = readFileSync(
    fileURLToPath(new URL("../infra/security-audit/worker-v7-hardened.js", import.meta.url)),
    "utf8",
  );
  const ingestSource = src("./yt-sync-ingest.ts");

  it("settings getAll serves only allowlisted sections (deny-by-default partition)", () => {
    expect(settingsSource).toContain("PUBLIC_SETTINGS_SECTIONS");
    expect(settingsSource).toContain("if (!PUBLIC_SETTINGS_SECTIONS.has(s.section)) continue;");
    // the secret/internal sections must not be in the allowlist
    const allowlistBlock = settingsSource.match(/PUBLIC_SETTINGS_SECTIONS = new Set\(\[([\s\S]*?)\]\)/);
    expect(allowlistBlock).not.toBeNull();
    const allowlist = allowlistBlock![1];
    expect(allowlist).not.toContain("adminRecovery");
    expect(allowlist).not.toContain("youtubeSync");
    expect(allowlist).not.toContain("youtubeWatch");
  });

  it("settings getSection rejects non-public sections BEFORE the cache lookup (refine)", () => {
    // the refine must be part of the input schema (runs pre-resolver, pre-cache)
    expect(settingsSource).toMatch(/\.refine\(/);
    expect(settingsSource).toContain("PUBLIC_SETTINGS_SECTIONS.has(v.section)");
    // the refine must appear BEFORE the cache get in the source order
    const refineIdx = settingsSource.indexOf(".refine(");
    const cacheGetIdx = settingsSource.indexOf("cache.get<Record<string, string>>");
    expect(refineIdx).toBeGreaterThan(-1);
    expect(cacheGetIdx).toBeGreaterThan(-1);
    expect(refineIdx).toBeLessThan(cacheGetIdx);
  });

  it("db-init ADMIN_RECOVERY branches invalidate the settings cache", () => {
    const dbInitSource = src("./lib/db-init.ts");
    // claim + restore + reset2fa each log then invalidate (4 total call sites incl. seed)
    const callCount = (dbInitSource.match(/await invalidateSettingsCache\(\)/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(4);
    expect(dbInitSource).toContain('"[DB] admin recovery: claimed');
  });

  it("SafeUser is a curated Pick<> and AuthMeOutput exists with exactly the 7 fields", () => {
    expect(contextSource).toContain('export type SafeUser = Pick<');
    expect(contextSource).not.toContain('Omit<User, "passwordHash">');
    expect(contextSource).toContain('export const AuthMeOutput = z.object(');
    // the explicit projection replaces the passwordHash destructure
    expect(contextSource).not.toContain("const { passwordHash: _ph, ...safeUser } = user;");
    expect(contextSource).toContain("const safeUser: SafeUser = {");
    // secrets must not appear in the projection object
    const projectionBlock = contextSource.match(/const safeUser: SafeUser = \{([\s\S]*?)\};/);
    expect(projectionBlock).not.toBeNull();
    const projection = projectionBlock![1];
    expect(projection).not.toContain("totpSecret");
    expect(projection).not.toContain("totpBackupCodes");
    expect(projection).not.toContain("passwordResetToken");
    expect(projection).not.toContain("deviceFingerprint");
    expect(projection).not.toContain("pendingEmail");
    expect(projection).not.toContain("tokenVersion");
  });

  it("loadUserFromDb full-row select keeps tokenVersion revocation intact", () => {
    // revocation compares the payload against the FULL DB row before projection
    expect(contextSource).toMatch(/payload\.tokenVersion !== user\.tokenVersion/);
  });

  it("BOTH identity endpoints enforce the shared AuthMeOutput runtime strip", () => {
    expect(localAuthSource).toContain("authedQuery.output(AuthMeOutput)");
    expect(authRouterSource).toContain("authedQuery.output(AuthMeOutput)");
    // no identity endpoint returns ctx.user without the output gate
    expect(authRouterSource).not.toMatch(/me:\s*authedQuery\.query\(\(opts\)\s*=>\s*opts\.ctx\.user\)/);
    expect(localAuthSource).not.toMatch(/me:\s*authedQuery\.query\(\(\{\s*ctx\s*\}\)\s*=>\s*\{\s*[\s\S]*?return ctx\.user;\s*\}\s*\),?\s*\n\s*\/\/(?!.*output)/);
  });

  it("quiz byLesson and submit enforce the lesson publish gate", () => {
    expect(quizSource).toContain("eq(lessons.isPublished, true)");
    const gateCount = (quizSource.match(/eq\(lessons\.isPublished, true\)/g) ?? []).length;
    expect(gateCount).toBe(2); // byLesson + submit lookups
  });

  it("progress completed-side queries match the total side publish predicate", () => {
    // recalcEnrollmentProgress + getCourseProgressDetail completed sides + total sides
    const completedSideCount = (progressSource.match(/eq\(lessons\.isPublished, true\)/g) ?? []).length;
    expect(completedSideCount).toBe(4); // 2 total sides + 2 completed sides
    // certificate grade input carries the same predicate
    expect(certificateSource).toContain("eq(lessons.isPublished, true)");
  });

  it("course-watching joins courses and requires the course-level publish gate", () => {
    expect(watchingSource).toContain("eq(courses.isPublished, true)");
    const gateCount = (watchingSource.match(/eq\(courses\.isPublished, true\)/g) ?? []).length;
    expect(gateCount).toBe(3); // lessonVideo + markWatched + heartbeat
    expect(watchingSource).toContain(".innerJoin(courses, eq(lessons.courseId, courses.id))");
    // lessonVideo's projection must carry videoUrl + id (Phase-5 runtime-safety correction)
    expect(watchingSource).toContain("videoUrl: lessons.videoUrl");
    expect(watchingSource).toContain("id: lessons.id");
  });

  it("ALL promo surfaces use the per-window limiter — no cap-as-cost remains", () => {
    expect(promoSource).toContain('rateLimitPerWindow("promo-apply"');
    expect(promoSource).toContain('rateLimitPerWindow("promo-internal"');
    expect(promoSource).toContain('rateLimitPerWindow("promo-validate"');
    // no future cap-as-cost call can reintroduce the cost-vs-cap confusion
    expect(promoSource).not.toContain("rateLimit(`promo:");
  });

  it("Google OAuth callback sets the identity-switch marker; SPA boot purges pre-render", () => {
    expect(cookiesSource).toContain("elbaz_identity_switch");
    expect(cookiesSource).toContain("httpOnly: false"); // main.tsx must read it via document.cookie
    expect(googleAuthSource).toContain("serializeIdentitySwitchCookie(");
    // the marker is set BEFORE the bare '/' redirect on the success path
    const markerIdx = googleAuthSource.indexOf("serializeIdentitySwitchCookie(");
    const redirectIdx = googleAuthSource.indexOf('c.redirect("/")');
    expect(markerIdx).toBeGreaterThan(-1);
    expect(redirectIdx).toBeGreaterThan(markerIdx);
    // main.tsx purges the persisted cache pre-render and consumes the marker
    expect(mainSource).toContain("elbaz_identity_switch=1");
    expect(mainSource).toContain("localStorage.removeItem('ELBAZ_QUERY_CACHE')");
    expect(mainSource).toContain("__elbazIdentitySwitchPurged");
    // belt-and-braces in-memory clear rides the restore success callback
    expect(trpcProviderSource).toContain("__elbazIdentitySwitchPurged");
    expect(trpcProviderSource).toContain("queryClient.clear()");
  });

  it("yt-sync STEP 1: worker cron signs body+'.'+ts with x-sync-ts; ingest warns on body-only", () => {
    // worker must NOT sign the raw body alone anymore
    expect(workerSource).toContain("enc.encode(`${body}.${ts}`)");
    expect(workerSource).toContain("'x-sync-ts': ts");
    expect(workerSource).not.toContain("enc.encode(body));");
    // ingest keeps the dual-accept transition lane but flags every accept
    expect(ingestSource).toContain("DEPRECATED body-only HMAC accepted");
    expect(ingestSource).toContain("replayProtected: false");
  });
});
