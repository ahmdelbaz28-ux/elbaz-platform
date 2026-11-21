/**
 * BYOK CRYPTO — at-rest encryption for user-supplied provider API keys.
 *
 * Threat model: a user's BYOK key must never rest in the database as
 * plaintext and must never be readable back through the API (write-only,
 * masked last-4 preview only). The ciphertext is AES-256-GCM with a key
 * derived from the platform APP_SECRET via sha256 domain separation — no new
 * environment variable to provision on any deployment target (HF Spaces /
 * Vercel / local), while staying independent of the JWT signing usage.
 *
 * Ciphertext wire format: "v1.<iv b64url>.<tag b64url>.<ct b64url>"
 *   - v1 prefix lets the format evolve (key rotation) without ambiguity.
 *   - GCM authenticates confidentiality — a tampered row fails decryption
 *     and the BYOK lane simply falls back to platform models.
 */

import crypto from "node:crypto";
import { env } from "./env.js";

const CIPHER_PREFIX = "v1";
const DOMAIN = "byok-v1";

function derivedKey(): Buffer {
  // sha256(APP_SECRET + domain) → 32 bytes for AES-256. Domain separation
  // keeps this key unrelated to any other APP_SECRET-derived key.
  return crypto.createHash("sha256").update(`${env.APP_SECRET}:${DOMAIN}`).digest();
}

/** Encrypt a plaintext API key → storable ciphertext string. */
export function encryptByokKey(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a stored ciphertext → plaintext key, or null when the value is
 * missing/corrupt/tampered (fail-closed: callers fall back to the platform
 * cascade instead of erroring the chat).
 */
export function decryptByokKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== CIPHER_PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const out = pt.toString("utf8");
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Last-4 preview for the UI (mirrors ai-router.maskApiKey contract). */
export function maskByokKey(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `••••${tail}`;
}
