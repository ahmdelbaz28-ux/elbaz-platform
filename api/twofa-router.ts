import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, authQuery, authMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { randomBytes, createHmac } from "crypto";
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
  const cleaned = base32.toUpperCase().replace(/=/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of cleaned) {
    const val = BASE32_CHARS.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secret: string, timeStep: number): string {
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

function verifyTotp(secret: string, token: string, window: number = 1): boolean {
  const timeStep = Math.floor(Date.now() / 30000);
  const cleanToken = token.replace(/\s/g, "");
  for (let i = -window; i <= window; i++) {
    if (generateTotpCode(secret, timeStep + i) === cleanToken) return true;
  }
  return false;
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

function hashToken(token: string): string {
  return createHmac("sha256", getBackupCodeHmacKey()).update(token.toLowerCase()).digest("hex").substring(0, 32);
}

export const twoFaRouter = createRouter({
  setup: authMutation.mutation(async ({ ctx }) => {
    const db = getDb();
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
    .input(z.object({ token: z.string().length(6) }))
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
      const backupIndex = backupCodes.findIndex((code) => code === tokenHash);

      if (backupIndex !== -1) {
        backupCodes.splice(backupIndex, 1);
        await db
          .update(users)
          .set({ totpEnabled: true, totpBackupCodes: JSON.stringify(backupCodes) })
          .where(eq(users.id, ctx.user.id));
        return { success: true, usedBackup: true, remaining: backupCodes.length };
      }

      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid 2FA code" });
    }),

  disable: authMutation
    .input(z.object({ token: z.string().length(6) }))
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

  regenerateBackupCodes: authMutation.mutation(async ({ ctx }) => {
    const db = getDb();
    const [user] = await db
      .select({ totpSecret: users.totpSecret })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user?.totpSecret) throw new TRPCError({ code: "BAD_REQUEST", message: "2FA not set up" });

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
