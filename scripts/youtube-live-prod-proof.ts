/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIVE YouTube INTEGRATION PROOF — production end-to-end
 * ───────────────────────────────────────────────────────────────────────────
 *  Verifies the REAL production YouTube lesson pipeline at the HF Space:
 *    1. Public course list loads (tRPC course.list → { items }).
 *    2. Course detail resolves with published lessons (course.bySlug).
 *    3. Fresh-user register + remember=true login (real cookie jar).
 *    4. Authenticated course.lessonVideo on a free lesson returns
 *       kind="youtube" with a valid 11-char id and a youtube-nocookie
 *       privacy-enhanced embed URL (video-protection.ts Strategy 0).
 *    5. oEmbed verdict for the served video id (public YouTube reachability).
 *    6. Premium gate: a premium course lessonVideo FORBIDDEN for the fresh
 *       user (enrollment protection still holds on the YouTube path).
 *  Exit 0 = all checks pass.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { extractYouTubeId, isYouTubeVideoRef } from "../src/lib/youtube-url.js";

const BASE = process.env.LIVE_BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "Content-Type": "application/json",
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
};

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  // ✅ S5145 (root cure): detail may carry server-provided text — control
  // characters are stripped so a hostile response can never forge log lines.
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  }
}

function cookieFrom(res: Response, jar: string[]): void {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const name = pair.split("=")[0];
    const idx = jar.findIndex((c) => c.startsWith(name + "="));
    if (idx >= 0) jar.splice(idx, 1);
    jar.push(pair);
  }
}

async function trpcCall(
  proc: string,
  input: unknown,
  jar: string[],
  method: "GET" | "POST" = "GET",
): Promise<{ status: number; json: unknown }> {
  // ✅ S8476 (root cure): proc is an internal constant at every call site —
  // the tRPC procedure-name shape is enforced, and the name is URL-encoded
  // into its own path component so no forged URL can ever be built from it.
  if (!/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/.test(proc)) {
    throw new Error(`invalid procedure name: ${proc}`);
  }
  const procSafe = encodeURIComponent(proc);
  const url = method === "GET" && input !== undefined
    ? `${BASE}/api/trpc/${procSafe}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: input } }))}`
    : `${BASE}/api/trpc/${procSafe}?batch=1`;
  // NOSONAR — S8476 reviewed false positive: `url` is built solely from the
  // module constant BASE and regex-validated, URL-encoded internal procedure
  // names ("auth.login", "course.list", …). No user-controlled value can
  // reach the fetch target; `input` only rides the fully encoded query value.
  const res = await fetch(url, {
    method,
    headers: { ...H, ...(jar.length ? { Cookie: jar.join("; ") } : {}) },
    ...(method === "POST" ? { body: JSON.stringify({ 0: { json: input } }) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  cookieFrom(res, jar);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch { /* error body may be empty */ }
  return { status: res.status, json };
}

function unwrap(json: unknown): unknown {
  const arr = json as Array<{ result?: { data?: { json?: unknown } } }> |
    Array<{ error?: { json?: { message?: string; code?: string } } }> | null;
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const first = arr[0] as { result?: { data?: { json?: unknown } }; error?: { json?: { message?: string; code?: string } } };
  if (first.result?.data) return first.result.data.json;
  if (first.error) return { __error: first.error.json };
  return undefined;
}

interface LessonVideoResult {
  videoUrl?: string;
  kind?: string;
  youtubeId?: string | null;
  expiresAt?: string;
}

async function main(): Promise<void> {
  console.log(`\n═══ LIVE YouTube integration proof @ ${BASE} ═══\n`);

  // ── 1) Course list
  const jar: string[] = [];
  const listRes = await trpcCall("course.list", { limit: 20 }, jar);
  const list = unwrap(listRes.json) as { items?: Array<{ id: number; slug: string; titleAr?: string; isPremium?: boolean }> } | undefined;
  const courses = list?.items ?? [];
  check("course.list returns courses", courses.length > 0, `${courses.length} courses`);
  const etap = courses.find((c) => c.slug.includes("etap")) ?? courses[0];
  check("ETAP course present in the public feed", !!etap, etap ? `"${etap.titleAr ?? etap.slug}"` : "none");

  // ── 2) Course detail (published lessons)
  const detailRes = await trpcCall("course.bySlug", { slug: etap!.slug }, jar);
  const detail = unwrap(detailRes.json) as { id?: number; lessons?: Array<{ id: number; titleAr?: string; isFree?: boolean }> } | undefined;
  const lessons = detail?.lessons ?? [];
  check("course.bySlug returns published lessons", lessons.length > 0, `${lessons.length} lessons`);
  const freeLesson = lessons.find((l) => l.isFree) ?? lessons[0];

  // ── 3) Fresh user + remember=true login (same contract as the auth E2E)
  const stamp = Date.now().toString(36);
  const USERNAME = `ytp${stamp}`.slice(0, 20);
  const PASSWORD = `YtProof${stamp}A1`;
  const reg = await trpcCall("auth.register", { username: USERNAME, password: PASSWORD, name: "yt proof" }, jar, "POST");
  check("auth.register succeeds", reg.status === 200, `HTTP ${reg.status}`);
  const login = await trpcCall("auth.login", { username: USERNAME, password: PASSWORD, remember: true }, jar, "POST");
  check("auth.login succeeds", login.status === 200, `HTTP ${login.status}`);
  const meRes = await trpcCall("auth.me", undefined, jar);
  const me = unwrap(meRes.json) as { id?: number; username?: string } | undefined;
  check("auth.me resolves the session (no false-401)", !!me?.id, me?.username ?? "");

  // ── 4) Authenticated lessonVideo → YouTube pass-through
  const lv = await trpcCall("course.lessonVideo", { lessonId: freeLesson!.id }, jar);
  const video = unwrap(lv.json) as LessonVideoResult | undefined;
  const isErr = (video as { __error?: unknown } | undefined)?.__error !== undefined;
  check("course.lessonVideo authorizes a free lesson", !isErr && !!video, isErr ? "error envelope" : `kind=${video?.kind}`);
  check("secure URL kind === youtube", video?.kind === "youtube", video?.kind ?? "undefined");
  check("youtubeId is a valid 11-char id", !!video?.youtubeId && /^[A-Za-z0-9_-]{11}$/.test(video.youtubeId), video?.youtubeId ?? "missing");
  check(
    "embed URL rides youtube-nocookie with origin scoping",
    !!video?.videoUrl && video.videoUrl.startsWith("https://www.youtube-nocookie.com/embed/") && video.videoUrl.includes("origin="),
    video?.videoUrl?.slice(0, 72),
  );
  const ref = `https://www.youtube.com/watch?v=${video?.youtubeId}`;
  check("returned id survives extractYouTubeId round-trip", isYouTubeVideoRef(ref) && extractYouTubeId(ref) === video?.youtubeId);

  // ── 5) oEmbed verdict for the served id
  if (video?.youtubeId) {
    // ✅ S8476 (root cure): youtubeId comes from the API response — it must
    // match the YouTube id shape before it is ever embedded into a fetch URL.
    const oembedId = video.youtubeId;
    if (!/^[A-Za-z0-9_-]{8,16}$/.test(oembedId)) {
      check("served video oEmbed verdict = ok (200)", false, "id failed the YouTube shape check");
    } else {
      try {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${oembedId}`)}&format=json`,
          { signal: AbortSignal.timeout(15_000) },
        );
        check("served video oEmbed verdict = ok (200)", res.ok, `HTTP ${res.status}`);
        if (res.ok) {
          const meta = (await res.json()) as { title?: string; author_name?: string };
          // ✅ S5145 (root cure): provider-supplied strings are sanitized
          // before they reach the log.
          const title = (meta.title ?? "").replace(/\p{Cc}+/gu, " ").slice(0, 120);
          const author = (meta.author_name ?? "").replace(/\p{Cc}+/gu, " ").slice(0, 80);
          console.log(`  └─ oEmbed: "${title}" — ${author}`);
        }
      } catch (err) {
        check("served video oEmbed verdict = ok (200)", false, String(err));
      }
    }
  }

  // ── 6) Premium gate still holds on the YouTube path
  const premium = courses.find((c) => c.isPremium === true);
  if (premium) {
    const pDetailRes = await trpcCall("course.bySlug", { slug: premium.slug }, jar);
    const pDetail = unwrap(pDetailRes.json) as { lessons?: Array<{ id: number; isFree?: boolean }> } | undefined;
    const paidLesson = pDetail?.lessons?.find((l) => !l.isFree) ?? pDetail?.lessons?.[0];
    if (paidLesson) {
      const pv = await trpcCall("course.lessonVideo", { lessonId: paidLesson.id }, jar);
      const pvBody = unwrap(pv.json) as { __error?: { code?: string } } | undefined;
      const gated = pv.status !== 200 || (pvBody as { __error?: { code?: string } } | undefined)?.__error !== undefined;
      check("premium lessonVideo is gated for a non-enrolled user", gated, `HTTP ${pv.status}`);
    } else {
      console.log("  · premium course has no resolvable lesson — gate check skipped");
    }
  } else {
    console.log("  · no premium course in the feed — gate check skipped");
  }

  console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
