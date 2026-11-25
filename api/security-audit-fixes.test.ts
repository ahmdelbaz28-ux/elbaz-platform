/**
 * Security audit run-1 → FIX regression tests.
 *
 * Every block pins one audit finding's fix:
 *   - ai.chatbot.vision-quota-check-increment-race  → tryConsumeImageQuota
 *     (atomic SELECT … FOR UPDATE reserve) + refundImageQuota on failures
 *   - yt-sync-ingest.legacy-body-only-hmac.unbounded-replay-lane (STEP 2)
 *     → authenticateIngest hard-rejects body-only signatures
 *   - api/quiz-router.ts:byLesson+submit:missing-course-level-publish-gate
 *     → course-level publish predicate in both quiz procedures
 *   - api/comments-router.ts:list-unpublished-parent-comment-read
 *     → lesson+course publish joins on the anonymous list
 *   - certificate-router.grade-gate.passed-only-denominator
 *     → grade average runs over EVERY published quiz lesson
 *   - admin-users.updateUserRole.last-admin-guard.race-to-zero-admins
 *     → conditional atomic demote (guard travels with the write)
 *   - push-subscribe.user-cap.toctou-insert-race
 *     → cap check + insert in one FOR UPDATE transaction
 *   - Dockerfile.node22-alpine.mutable-base-tag → digest-pinned FROM
 *   - relay contract for STEP 2 → yt_playlist_relay.py sends x-sync-ts
 *
 * DB-dependent paths run against an in-memory fake pool that SERIALIZES
 * operations through a promise chain — the same interleaving semantics
 * InnoDB row locks give the real statements — so the race-class assertions
 * are behavioral, not string checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── image-quota: mock the shared pool BEFORE importing the module ────────────
type RowMap = Map<string, number>;

interface FakePoolOptions {
  /** Simulate a DB outage: every connection execute() throws. */
  failTxs?: boolean;
}

function makeFakePool(initial: Record<string, number> = {}, opts: FakePoolOptions = {}) {
  const rows: RowMap = new Map(Object.entries(initial));
  const calls: string[] = [];
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  // InnoDB semantics model: statements from concurrent transactions interleave
  // freely, but a row LOCK (SELECT … FOR UPDATE) held by an uncommitted
  // transaction makes other connections' FOR UPDATE on the same row WAIT
  // until commit/rollback releases it. Modeled as a per-key async mutex —
  // the same interleaving semantics the production statements rely on.
  const locks = new Map<string, { holders: Set<symbol>; queue: (() => void)[] }>();
  async function acquire(key: string, owner: symbol): Promise<void> {
    let l = locks.get(key);
    if (!l) {
      l = { holders: new Set(), queue: [] };
      locks.set(key, l);
    }
    if (l.holders.has(owner)) return; // re-entrant (same tx)
    if (l.holders.size > 0) {
      await new Promise<void>((resolve) => l.queue.push(resolve));
    }
    l.holders.add(owner);
  }
  function release(key: string, owner: symbol): void {
    const l = locks.get(key);
    if (!l) return;
    l.holders.delete(owner);
    const next = l.queue.shift();
    if (next) next();
  }

  const handleSql = (sql: string, params: unknown[]): unknown => {
    // Keep the full statement — the shape assertions look for "FOR UPDATE",
    // which sits past an 80-char prefix of the SELECT.
    calls.push(sql.replace(/\s+/g, " ").slice(0, 200));
    if (sql.includes("FOR UPDATE")) {
      const [key, day] = params as [string, string];
      const used = rows.get(`${key}|${day}`) ?? 0;
      return [[{ imagesUsed: used }]];
    }
    if (sql.startsWith("INSERT")) {
      const [key, day, n] = params as [string, string, number];
      const k = `${key}|${day}`;
      rows.set(k, (rows.get(k) ?? 0) + Number(n));
      return [{ affectedRows: 1, insertId: 1 }];
    }
    if (sql.startsWith("UPDATE")) {
      const [n, key, day] = params as [number, string, string];
      const k = `${key}|${day}`;
      const cur = rows.get(k) ?? 0;
      rows.set(k, Math.max(0, cur - Number(n)));
      return [{ affectedRows: cur > 0 ? 1 : 0 }];
    }
    return [[]];
  };

  const makeConn = () => {
    const id = Symbol("conn");
    const heldKeys = new Set<string>();
    return {
      execute: async (sql: string, params: unknown[] = []) => {
        await tick();
        if (opts.failTxs) throw new Error("db down (simulated outage)");
        // A locking read on row K must WAIT while another uncommitted tx
        // holds K — exactly the serialization the production invariant needs.
        if (sql.includes("FOR UPDATE")) {
          const [key] = params as [string];
          await acquire(key, id);
          heldKeys.add(key);
        }
        return handleSql(sql, params);
      },
      beginTransaction: async () => { await tick(); },
      commit: async () => {
        await tick();
        for (const k of heldKeys) release(k, id);
        heldKeys.clear();
      },
      rollback: async () => {
        await tick();
        for (const k of heldKeys) release(k, id);
        heldKeys.clear();
      },
      release: () => {},
    };
  };

  return {
    pool: {
      execute: (sql: string, params: unknown[] = []) => handleSql(sql, params),
      getConnection: async () => makeConn(),
    },
    rows,
    calls,
  };
}

const { fake } = vi.hoisted(() => ({ fake: { current: null as ReturnType<typeof makeFakePool> | null } }));

vi.mock("./queries/connection.js", () => ({
  pool: {
    execute: (sql: string, params?: unknown[]) => {
      if (!fake.current) throw new Error("fake pool not initialized");
      return fake.current.pool.execute(sql, params);
    },
    getConnection: async () => {
      if (!fake.current) throw new Error("fake pool not initialized");
      return fake.current.pool.getConnection();
    },
  },
  db: {},
  getDb: () => ({}),
  withTransaction: async <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
}));

import { tryConsumeImageQuota, refundImageQuota } from "./lib/image-quota.js";
import { authenticateIngest, computeSignature, TS_WINDOW_MS } from "./lib/yt-sync-auth.js";
const ctxWith = (headers: Record<string, string>) => ({ req: { header: (n: string) => headers[n.toLowerCase()] } });

describe("audit run-1 fixes: vision quota reserve-then-refund", () => {
  beforeEach(() => {
    fake.current = makeFakePool();
  });

  it("admits up to the limit and refuses past it (5/day lane)", async () => {
    const key = `test-key-a`;
    expect(await tryConsumeImageQuota(key, 2, 5)).toMatchObject({ admitted: true, used: 2 });
    expect(await tryConsumeImageQuota(key, 2, 5)).toMatchObject({ admitted: true, used: 4 });
    expect(await tryConsumeImageQuota(key, 2, 5)).toMatchObject({ admitted: false, used: 4 }); // 4+2 > 5
    expect(await tryConsumeImageQuota(key, 1, 5)).toMatchObject({ admitted: true, used: 5 });
    expect(await tryConsumeImageQuota(key, 1, 5)).toMatchObject({ admitted: false, used: 5 });
  });

  it("the reservation is ATOMIC under a concurrent burst — the audit's 30-burst admits exactly limit", async () => {
    const key = `test-key-burst`;
    const limit = 4;
    const results = await Promise.all(
      Array.from({ length: 30 }, () => tryConsumeImageQuota(key, 1, limit)),
    );
    const admitted = results.filter((r) => r.admitted).length;
    expect(admitted).toBe(limit); // old code admitted ~30; the reserve admits exactly 4
    const last = results[results.length - 1]!;
    expect(last.used).toBe(limit);
  });

  it("refund restores capacity exactly once per failed dispatch", async () => {
    const key = `test-key-refund`;
    await tryConsumeImageQuota(key, 5, 5);
    expect(await tryConsumeImageQuota(key, 1, 5)).toMatchObject({ admitted: false });
    await refundImageQuota(key, 5);
    expect(await tryConsumeImageQuota(key, 5, 5)).toMatchObject({ admitted: true, used: 5 });
    // Refund floors at zero — over-refunding cannot create capacity.
    await refundImageQuota(key, 99);
    expect(await tryConsumeImageQuota(key, 5, 5)).toMatchObject({ admitted: true, used: 5 });
    expect(await tryConsumeImageQuota(key, 1, 5)).toMatchObject({ admitted: false });
  });

  it("DB outage keeps the quota enforceable through the mirror (fail-closed)", async () => {
    fake.current = makeFakePool({}, { failTxs: true });
    const key = `test-key-outage`;
    expect(await tryConsumeImageQuota(key, 3, 5)).toMatchObject({ admitted: true, used: 3 });
    expect(await tryConsumeImageQuota(key, 3, 5)).toMatchObject({ admitted: false, used: 3 });
  });

  it("admission uses one locking SELECT + one upsert in the SAME transaction", async () => {
    const key = `test-key-shape`;
    await tryConsumeImageQuota(key, 1, 5);
    const reserveCalls = fake.current!.calls.filter((c) => c.includes("FOR UPDATE"));
    expect(reserveCalls).toHaveLength(1);
    expect(reserveCalls[0]).toContain("chatbotImageQuota");
    expect(fake.current!.calls.some((c) => c.startsWith("INSERT INTO `chatbotImageQuota`"))).toBe(true);
  });
});

describe("audit run-1 STEP 2: yt-sync replay lane retired", () => {
  const SECRET = "sync-ingest-secret-test-0123456789";
  const BODY = JSON.stringify({ videos: [{ videoId: "dQw4w9WgXcQ", title: "Test episode" }] });

  it("a captured body-only request is REJECTED even with a perfectly valid signature", () => {
    const legacySig = computeSignature(SECRET, BODY); // exactly what an attacker replays
    const outcome = authenticateIngest(SECRET, BODY, ctxWith({ "x-sync-signature": legacySig }));
    expect(outcome).toMatchObject({ ok: false, status: 401, replayProtected: false });
  });

  it("a fresh ts-signed request from the migrated relay is accepted", () => {
    const ts = String(Date.now());
    const sig = computeSignature(SECRET, `${BODY}.${ts}`);
    const outcome = authenticateIngest(SECRET, BODY, ctxWith({ "x-sync-signature": sig, "x-sync-ts": ts }));
    expect(outcome).toMatchObject({ ok: true, replayProtected: true });
  });

  it("timestamps outside the 10-minute window are refused (stale replay dies)", () => {
    const staleTs = String(Date.now() - (TS_WINDOW_MS + 60_000));
    const sig = computeSignature(SECRET, `${BODY}.${staleTs}`);
    const outcome = authenticateIngest(SECRET, BODY, ctxWith({ "x-sync-signature": sig, "x-sync-ts": staleTs }));
    expect(outcome).toMatchObject({ ok: false, status: 401, replayProtected: true });
  });

  it("a tampered body under a valid envelope is refused", () => {
    const ts = String(Date.now());
    const sig = computeSignature(SECRET, `${BODY}.${ts}`);
    const tampered = BODY.replace("Test episode", "Evil title");
    const outcome = authenticateIngest(SECRET, tampered, ctxWith({ "x-sync-signature": sig, "x-sync-ts": ts }));
    expect(outcome).toMatchObject({ ok: false, status: 401, replayProtected: true });
  });

  it("non-numeric timestamps are refused (fail-closed)", () => {
    const outcome = authenticateIngest(SECRET, BODY, ctxWith({ "x-sync-signature": "00", "x-sync-ts": "not-a-ts" }));
    expect(outcome).toMatchObject({ ok: false, status: 401 });
  });
});

// ── Source pins: the invariant travels with the file, a revert trips CI ──────
const repo = (p: string) => readFileSync(new URL(p, import.meta.url), "utf-8");

describe("audit run-1 fixes: source pins (revert guards)", () => {
  it("quiz read+submit enforce the COURSE-level publish gate", () => {
    const src = repo("./quiz-router.ts");
    expect(src.match(/eq\(courses\.isPublished, true\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("scoreQuizSubmission(questions, input.answers)");
    expect(src).toContain("new Set(answers.map((a) => a.questionId)).size === answers.length");
  });

  it("comments.list joins lesson+course publish predicates", () => {
    const src = repo("./comments-router.ts");
    expect(src).toContain("eq(lessons.isPublished, true)");
    expect(src).toContain("eq(courses.isPublished, true)");
    expect(src).toContain(".innerJoin(lessons, eq(lessonComments.lessonId, lessons.id))");
  });

  it("certificate grade denominator is every published quiz lesson (passed-only filter gone)", () => {
    const src = repo("./certificate-router.ts");
    expect(src).toContain("quizLessonIds");
    expect(src).toContain("scoreByLesson");
    expect(src).not.toContain("eq(lessonProgress.isQuizPassed");
  });

  it("last-admin guard travels with the write (conditional atomic demote)", () => {
    const src = repo("./admin-users.ts");
    expect(src).toContain("adminGuard) > 1");
    expect(src).toContain("affectedRows");
  });

  it("push subscription cap is enforced inside a FOR UPDATE transaction", () => {
    const src = repo("./push-subscription-route.ts");
    expect(src).toContain('for("update")');
    expect(src).toContain("withTransaction(async (tx)");
  });

  it("chatbot vision quota: reserve in preflight, refund on every failure path, no post-dispatch increment", () => {
    const src = repo("./chatbot-router.ts");
    expect(src).toContain("tryConsumeImageQuota(quotaLane.key, imageCount, quotaLane.limit)");
    expect(src.match(/refundImageQuota\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(src).not.toContain("incrementImageQuota(");
    expect(src).not.toContain("getImageQuotaUsed(");
  });

  it("/__webhook/status gate prefers the shared status token over IP trust", () => {
    const src = repo("./boot.ts");
    expect(src).toContain("WEBHOOK_STATUS_TOKEN");
    expect(src).toContain("timingSafeEqual(providedBuf, expectedBuf)");
  });

  it("Dockerfile pins the production base image to an immutable digest", () => {
    const src = repo("../Dockerfile");
    expect(src).toContain(
      "FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a",
    );
  });

  it("the yt relay contract matches STEP 2 (sends x-sync-ts) — the lane can stay closed", () => {
    const relay = repo("../scripts/yt_playlist_relay.py");
    expect(relay).toContain('"x-sync-ts"');
    expect(relay).toContain('"x-sync-signature"');
  });
});
