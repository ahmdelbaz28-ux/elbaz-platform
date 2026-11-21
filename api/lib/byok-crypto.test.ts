import { describe, it, expect } from "vitest";
import { encryptByokKey, decryptByokKey, maskByokKey } from "./byok-crypto";

describe("byok-crypto (AES-256-GCM at-rest encryption)", () => {
  it("round-trips a plaintext key", () => {
    const key = "sk-or-v1-abc123SECRET456";
    const stored = encryptByokKey(key);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(key);
    expect(decryptByokKey(stored)).toBe(key);
  });

  it("never reuses an IV (two ciphertexts of the same key differ)", () => {
    const key = "groq_gsk_same_key_both_times";
    expect(encryptByokKey(key)).not.toBe(encryptByokKey(key));
  });

  it("returns null for a tampered ciphertext (GCM auth failure)", () => {
    const stored = encryptByokKey("another-test-key-value");
    const parts = stored.split(".");
    // Flip one character of the ciphertext body — decryption must fail closed.
    const ct = parts[3];
    const flipped = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect(decryptByokKey([parts[0], parts[1], parts[2], flipped].join("."))).toBeNull();
  });

  it("returns null for corrupt / foreign formats (fail-closed)", () => {
    expect(decryptByokKey(null)).toBeNull();
    expect(decryptByokKey(undefined)).toBeNull();
    expect(decryptByokKey("")).toBeNull();
    expect(decryptByokKey("plaintext-not-encrypted")).toBeNull();
    expect(decryptByokKey("v1.only.two.parts")).toBeNull();
    expect(decryptByokKey("v2.v1.iv.ct")).toBeNull();
  });

  it("masks to the last 4 characters only", () => {
    expect(maskByokKey("sk-1234567890abcd")).toBe("••••abcd");
    expect(maskByokKey("ab")).toBe("••••ab");
    expect(maskByokKey("sk-full-key-value")).not.toContain("sk-full");
  });
});
