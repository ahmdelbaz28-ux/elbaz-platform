import { adminAuditLog } from "@db/schema";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getClientIpFromHeaders } from "./lib/client-ip";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { checkRateLimit } from "./lib/rate-limiter";
import { getDb } from "./queries/connection";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape }) => {
    // SECURITY FIX: In production, hide raw error messages for:
    // - INTERNAL_SERVER_ERROR: never expose DB errors, stack traces, etc.
    // - BAD_REQUEST: hide raw Zod validation arrays (technical JSON)
    if (env.isProduction) {
      const code = shape.data?.code;
      if (code === "INTERNAL_SERVER_ERROR") {
        return { ...shape, message: "An internal error occurred. Please try again later." };
      }
      // Clean up Zod validation errors — don't leak regex patterns and JSON arrays
      if (code === "BAD_REQUEST" && shape.message.startsWith("[")) {
        return { ...shape, message: "Invalid input. Please check your data and try again." };
      }
    }
    return shape;
  },
});

export const createRouter = t.router;
export { clearRateLimit, type RateLimitAction } from "./lib/rate-limiter";
export { authRateLimit, checkRateLimit };

const globalRateLimit = t.middleware(async (opts) => {
  // Unified IP extraction (cf-connecting-ip > x-real-ip > first x-forwarded-for)
  const ip = opts.ctx.req?.headers ? getClientIpFromHeaders(opts.ctx.req.headers) : "unknown";
  await checkRateLimit(ip, "api");
  return opts.next();
});

export const publicQuery = t.procedure.use(globalRateLimit);
export const publicMutation = t.procedure.use(globalRateLimit);

// Auth-specific rate limit middleware — runs BEFORE input validation.
// This prevents attackers from bypassing per-action rate limits by sending
// invalid inputs (which would fail Zod validation before reaching the
// in-handler checkRateLimit call).
// Usage: login: publicQuery.use(authRateLimit('login')).input(...).mutation(...)
function authRateLimit(action: import("./lib/rate-limiter").RateLimitAction) {
  return t.middleware(async (opts) => {
    const ip = opts.ctx.req?.headers ? getClientIpFromHeaders(opts.ctx.req.headers) : "unknown";
    await checkRateLimit(ip, action);
    return opts.next();
  });
}

const requireAuth = t.middleware(async (opts) => {
  // Human-readable message — clients that surface error.message verbatim
  // (instead of mapping the code) show something actionable, not "UNAUTHORIZED".
  if (!opts.ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Your session has expired. Please log in again." });
  return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    if (opts.ctx.user?.role !== role) {
      // ✅ SECURITY FIX (audit run-3, audit-role-denials-observable): FORBIDDEN
      // probes by authenticated non-admins were previously recorded nowhere
      // (auditAdmin runs after requireRole). A throttled warn line makes the
      // probe pattern visible to the operator without adding a DB write to
      // the hot path.
      logger.warn("[AuthZ] admin procedure denied", {
        procedure: opts.path,
        userId: opts.ctx.user?.id ?? null,
        username: opts.ctx.user?.username ?? null,
        requiredRole: role,
      });
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
  });
}

// ─── Admin audit trail (accountability choke point) ───
// EVERY admin.* procedure runs through auditAdmin: one row per call records
// WHO did WHAT, when, from where, with what (redacted) input, and whether it
// succeeded. Destructive ops (deleteCourse, updateUserRole, rejectManual…)
// are no longer anonymous logger lines. Design rules:
//   · runs AFTER requireRole → only successful authorisation is recorded
//   · audit failure is swallowed — logging must never break the request
//   · input values whose KEY looks sensitive are redacted BEFORE storage
//   · no FK on actorId — the trail survives user deletion
// ✅ SECURITY FIX (audit run-3, audit-redaction-settings-value-carrier): the
// generic "value" key is redacted too (EXACT key match, so discountValue etc.
// stay readable) — settings.upsert/bulkUpsert carry {section,key,value} and a
// future secret pasted as a setting value must never land in the trail.
const AUDIT_REDACT_KEY = /(password|passwd|token|secret|apikey|api_key|hash|credential|^value$)/i;
const AUDIT_INPUT_MAX = 400;
const auditWarnState = new Map<string, number>();

/** Exported for unit tests — redaction + truncation of audited input. */
export function auditInputSummary(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  try {
    const json = JSON.stringify(input);
    if (!json || json === "{}" || json === "null") return null;
    // ✅ ROOT FIX (audit self-test caught it): the first draft replaced only
    // the KEY ("password" → "***") and left the SECRET VALUE stored verbatim
    // in the audit table — worse than useless. The full "key":"value" pair is
    // matched and BOTH sides are replaced, so no sensitive value ever lands
    // in the trail. Escaped quotes inside values are handled.
    const redacted = json.replace(
      /"([^"]+)"\s*:\s*"(?:[^"\\]|\\.)*"/g,
      (m, k: string) => (AUDIT_REDACT_KEY.test(k) ? '"***":"[REDACTED]"' : m)
    );
    return redacted.length > AUDIT_INPUT_MAX
      ? `${redacted.slice(0, AUDIT_INPUT_MAX - 3)}...`
      : redacted;
  } catch {
    return null;
  }
}

const auditAdmin = t.middleware(async (opts) => {
  const result = await opts.next();
  try {
    const user = opts.ctx.user;
    if (!user) return result;
    // tRPC v11 exposes the call's raw input via getRawInput() (async, parses
    // lazily) — NOT opts.rawInput (CI's strict typecheck rejects the latter).
    let rawInput: unknown ;
    try {
      rawInput = await opts.getRawInput();
    } catch { /* input unavailable — audit without it */ }
    await getDb().insert(adminAuditLog).values({
      actorId: user.id,
      actorUsername: user.username,
      procedure: opts.path,
      kind: opts.type,
      status: result.ok ? "ok" : "error",
      inputSummary: auditInputSummary(rawInput),
      ip: opts.ctx.req?.headers ? getClientIpFromHeaders(opts.ctx.req.headers) : "unknown",
    });
  } catch (auditErr) {
    // ✅ SECURITY FIX (audit run-3, audit-failure-observable): the audit write
    // must never break the admin request, but a SILENT catch meant an
    // adminAuditLog outage produced zero signal — accountability degraded
    // invisibly. A throttled warn makes the degradation visible.
    const key = "auditAdminWarn";
    const now = Date.now();
    const last = (auditWarnState.get(key) ?? 0);
    if (now - last > 60_000) {
      auditWarnState.set(key, now);
      logger.warn("[Audit] adminAuditLog write failed (throttled warn)", {
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }
  }
  return result;
});

// 🔒 SECURITY FIX (Task ID 6): authMutation previously bypassed globalRateLimit,
// which meant login/register/forgotPassword were only protected by the per-IP
// shieldMiddleware (200 req / 10s = 1200/min). That's far too lenient for auth
// endpoints — bcrypt-12 at ~3 hashes/sec/core means 1200 login attempts/min
// would let an attacker test ~20k passwords/hour against a known email.
// We now apply globalRateLimit to ALL procedures, and sensitive auth actions
// additionally call checkRateLimit(ip, 'login') etc. with a much smaller
// per-action quota inside the procedure body.
export const authedQuery = t.procedure.use(globalRateLimit).use(requireAuth);
export const authQuery = authedQuery;
export const authMutation = t.procedure.use(globalRateLimit).use(requireAuth);
export const adminQuery = t.procedure.use(globalRateLimit).use(requireAuth).use(requireRole("admin")).use(auditAdmin);
export const adminMutation = t.procedure.use(globalRateLimit).use(requireAuth).use(requireRole("admin")).use(auditAdmin);