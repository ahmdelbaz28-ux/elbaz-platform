import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { createRouter, authQuery, authMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./lib/env";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateSecret(): string {
  let secret = "";
  const bytes = randomBytes(20);
  for (let i = 0; i < 20; i++) {
    secret += BASE32_CHARS[bytes[i] & 31];
  }
  return secret;
}

function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

function base32Decode(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replaceAll("=", "").replaceAll(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of cleaned) {
    const val = BASE32_CHARS.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, timeStep: number): string {
  const key = base32Decode(secret);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(timeStep), 0);
  const hmac = createHmac("sha1", key).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

// ✅ SECURITY FIX (audit run-1): exported so local-auth-router can enforce the
// enrolled second factor at the login boundary (previously 2FA was enrollable
// but never checked at login — password alone issued a full session).
// ✅ AUDIT RUN-2 FIX: constant-time comparison (the 6-char string compare
// with '===' was a timing side-channel on the last matching byte).
export function verifyTotp(secret: string, token: string, window: number = 1): boolean {
  const timeStep = Math.floor(Date.now() / 30000);
  const cleanToken = token.replaceAll(/\s/g, "");
  if (cleanToken.length !== 6) return false;
  for (let i = -window; i <= window; i++) {
    const generated = generateTotpCode(secret, timeStep + i);
    try {
      if (timingSafeEqual(Buffer.from(generated), Buffer.from(cleanToken))) return true;
    } catch {
      return false; // unequal lengths — cannot match
    }
  }
  return false;
}

/**
 * ✅ AUDIT RUN-2 FIX (second-factor takeover): proof of the CURRENT factor is
 * required before any factor-mutating operation on an enrolled account
 * (setup-on-enabled, regenerateBackupCodes). Accepts a valid TOTP code OR a
 * backup code — a backup code used as proof is CONSUMED atomically via a
 * conditional UPDATE (JSON_CONTAINS predicate), so two concurrent
 * redemptions cannot both succeed and a stolen session alone proves nothing.
 */
async function assertCurrentFactorProof(
  userId: number,
  totpSecret: string,
  backupCodesRaw: unknown,
  code: string,
): Promise<void> {
  if (verifyTotp(totpSecret, code)) return;

  const codes = Array.isArray(backupCodesRaw) ? (backupCodesRaw as string[]) : [];
  const tokenHash = hashToken(code);
  if (!codes.includes(tokenHash)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "رمز المصادقة الحالي غير صحيح" });
  }
  // Atomic single-use removal: the JSON_CONTAINS predicate fails when a
  // concurrent request already consumed this code.
  const result = await getDb()
    .update(users)
    .set({ totpBackupCodes: sql`JSON_REMOVE(${users.totpBackupCodes}, JSON_UNQUOTE(JSON_SEARCH(${users.totpBackupCodes}, 'one', ${tokenHash})))` })
    .where(and(eq(users.id, userId), sql`JSON_CONTAINS(${users.totpBackupCodes}, ${JSON.stringify(tokenHash)})`));
  const affected = Array.isArray(result) ? (result[0]?.affectedRows ?? 0) : 0;
  if (!affected) {
    throw new TRPCError({ code: "FORBIDDEN", message: "رمز الاسترداد مستخدم بالفعل" });
  }
}

// 🔒 SECURITY FIX (Task ID 3): Use APP_SECRET (or a dedicated WATERMARK_SECRET) as the
// HMAC key for hashing 2FA backup codes. Previously this was a hardcoded string
// "elbaz-2fa-backup" — anyone with repo access could forge backup codes.
// We derive a 32-byte key from APP_SECRET so the hash is bound to the deployment.
function getBackupCodeHmacKey(): string {
  const base = env.APP_SECRET || env.WATERMARK_SECRET || "";
  if (!base) {
    // In dev with no APP_SECRET, fall back to a clearly-marked dev key.
    // env.ts would have already thrown in production if APP_SECRET was missing.
    return "dev-only-2fa-backup-key-not-for-production-use-32chars";
  }
  // Stretch with HKDF-like derivation (SHA-256 of "2fa-backup" || APP_SECRET)
  // to domain-separate from JWT signing (which also uses APP_SECRET directly).
  return createHmac("sha256", base).update("elbaz-2fa-backup-codes-v1").digest("hex");
}

export function hashToken(token: string): string {
  return createHmac("sha256", getBackupCodeHmacKey()).update(token.toLowerCase()).digest("hex").substring(0, 32);
}

export const twoFaRouter = createRouter({
  setup: authMutation
    .input(z.object({ currentCode: z.string().min(6).max(8).optional() }))
    .mutation(async ({ ctx, input }) => {
    const db = getDb();
    // ✅ AUDIT RUN-2 FIX (second-factor takeover): re-enrolling on an
    // ALREADY-ENABLED account now requires proof of the CURRENT factor — a
    // bare stolen session can no longer silently replace the enrolled secret
    // and mint 8 fresh backup codes. First-time enrollment stays friction-free.
    const [current] = await db
      .select({ totpSecret: users.totpSecret, totpEnabled: users.totpEnabled, totpBackupCodes: users.totpBackupCodes })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (current?.totpEnabled && current.totpSecret) {
      if (!input.currentCode) {
        throw new TRPCError({ code: "FORBIDDEN", message: "أدخل رمز المصادقة الحالي لإعادة تعيين المصادقة الثنائية" });
      }
      await assertCurrentFactorProof(ctx.user.id, current.totpSecret, current.totpBackupCodes, input.currentCode);
    }

    const secret = generateSecret();
    const backupCodes = generateBackupCodes();
    const backupCodesHashed = backupCodes.map((code) => hashToken(code));

    await db
      .update(users)
      .set({
        totpSecret: secret,
        totpBackupCodes: JSON.stringify(backupCodesHashed),
      })
      .where(eq(users.id, ctx.user.id));

    const otpauthUrl = `otpauth://totp/Elbaz%20Platform:${encodeURIComponent(ctx.user.username)}?secret=${secret}&issuer=Elbaz%20Platform&digits=6&period=30`;

    return { secret, otpauthUrl, backupCodes };
  }),

  verify: authMutation
    // ✅ SECURITY FIX (audit run-1): accept the 8-hex backup codes this system
    // itself issues (previously z.string().length(6) made them unredeemable).
    .input(z.object({ token: z.string().min(6).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [user] = await db
        .select({ totpSecret: users.totpSecret, totpBackupCodes: users.totpBackupCodes })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user?.totpSecret) throw new TRPCError({ code: "BAD_REQUEST", message: "2FA not set up" });

      if (verifyTotp(user.totpSecret, input.token)) {
        await db.update(users).set({ totpEnabled: true }).where(eq(users.id, ctx.user.id));
        return { success: true };
      }

      const backupCodes = user.totpBackupCodes ? (user.totpBackupCodes as string[]) : [];
      const tokenHash = hashToken(input.token);

      // ✅ AUDIT RUN-2 FIX (backup-code race): the old read-splice-write let
      // two concurrent redemptions of the same code both succeed. The
      // conditional UPDATE removes the hash only if it is STILL present —
      // the loser of the race affects 0 rows and is rejected.
      const consumed = await db
        .update(users)
        .set({
          totpEnabled: true,
          totpBackupCodes: sql`JSON_REMOVE(${users.totpBackupCodes}, JSON_UNQUOTE(JSON_SEARCH(${users.totpBackupCodes}, 'one', ${tokenHash})))`,
        })
        .where(and(eq(users.id, ctx.user.id), sql`JSON_CONTAINS(${users.totpBackupCodes}, ${JSON.stringify(tokenHash)})`));
      const affected = Array.isArray(consumed) ? (consumed[0]?.affectedRows ?? 0) : 0;
      if (affected) {
        const remaining = Math.max(0, backupCodes.length - 1);
        return { success: true, usedBackup: true, remaining };
      }

      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid 2FA code" });
    }),

  disable: authMutation
    .input(z.object({ token: z.string().min(6).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [user] = await db
        .select({ totpSecret: users.totpSecret })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user?.totpSecret) throw new TRPCError({ code: "BAD_REQUEST", message: "2FA not set up" });
      if (!verifyTotp(user.totpSecret, input.token)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid 2FA code" });

      await db
        .update(users)
        .set({ totpSecret: null, totpEnabled: false, totpBackupCodes: null })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  status: authQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [user] = await db
      .select({ totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    return { enabled: user?.totpEnabled ?? false };
  }),

  regenerateBackupCodes: authMutation
    .input(z.object({ currentCode: z.string().min(6).max(8) }))
    .mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [user] = await db
      .select({ totpSecret: users.totpSecret, totpBackupCodes: users.totpBackupCodes })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user?.totpSecret) throw new TRPCError({ code: "BAD_REQUEST", message: "2FA not set up" });

    // ✅ AUDIT RUN-2 FIX (second-factor takeover): minting 8 fresh login-valid
    // backup codes now requires proof of the CURRENT factor — a stolen
    // session token alone can no longer mint codes that survive password
    // change and revoke-all-sessions.
    await assertCurrentFactorProof(ctx.user.id, user.totpSecret, user.totpBackupCodes, input.currentCode);

    const backupCodes = generateBackupCodes();
    const backupCodesHashed = backupCodes.map((code) => hashToken(code));

    await db
      .update(users)
      .set({ totpBackupCodes: JSON.stringify(backupCodesHashed) })
      .where(eq(users.id, ctx.user.id));

    return { backupCodes };
  }),

  // 🔒 SECURITY FIX (Task ID 6): Removed `verifyForLogin` procedure.
  // It was (a) declared as authMutation so 2FA users couldn't actually log in
  // through it (no way to issue a JWT after successful verification), (b) accepted
  // a client-supplied userId (IDOR — any user could test 2FA codes against any
  // other user's account), and (c) had no rate limit (allowed TOTP brute-force).
  // 2FA login verification is now handled inline in local-auth-router.ts
  // (login procedure) which already verifies credentials first, then asks for
  // the TOTP code with the same 30s window + brute-force protection.
});
