import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("Password Module", () => {
  // ─── hashPassword ──────────────────────────────────────────────────────

  describe("hashPassword()", () => {
    it("returns a bcrypt hash string starting with $2b$12$ (bcryptjs format)", async () => {
      const hash = await hashPassword("MySecureP@ssw0rd!");
      // bcryptjs uses $2b$ prefix (modern variant of $2a$)
      expect(hash).toMatch(/^\$2[ab]\$12\$.{53}$/);
    });

    it("produces different hashes for the same password (salt randomness)", async () => {
      const password = "samePassword123";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hashes for different passwords", async () => {
      const hash1 = await hashPassword("passwordOne!");
      const hash2 = await hashPassword("passwordTwo!");
      expect(hash1).not.toBe(hash2);
    });

    it("handles very short passwords", async () => {
      const hash = await hashPassword("a");
      expect(hash).toMatch(/^\$2[ab]\$12\$/);
    });

    it("handles very long passwords", async () => {
      const longPassword = "x".repeat(1000);
      const hash = await hashPassword(longPassword);
      expect(hash).toMatch(/^\$2[ab]\$12\$/);
    });

    it("returns a string (hashing is async)", async () => {
      const result = hashPassword("test");
      expect(result).toBeInstanceOf(Promise);
      const hash = await result;
      expect(typeof hash).toBe("string");
    });
  });

  // ─── verifyPassword ────────────────────────────────────────────────────

  describe("verifyPassword()", () => {
    it("returns true for correct password against its hash", async () => {
      const password = "CorrectP@ssw0rd";
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it("returns false for wrong password against a hash", async () => {
      const hash = await hashPassword("CorrectP@ssw0rd");
      expect(await verifyPassword("WrongP@ssw0rd!", hash)).toBe(false);
    });

    it("returns false for empty password string against a hash", async () => {
      const hash = await hashPassword("SomePassword123");
      expect(await verifyPassword("", hash)).toBe(false);
    });

    it("returns false for whitespace-only password against a hash", async () => {
      const hash = await hashPassword("SomePassword123");
      expect(await verifyPassword("   ", hash)).toBe(false);
    });

    it("returns false for password differing by one character", async () => {
      const hash = await hashPassword("Password123!");
      expect(await verifyPassword("Password123", hash)).toBe(false);
    });

    it("is case-sensitive", async () => {
      const hash = await hashPassword("CaseSensitive");
      expect(await verifyPassword("casesensitive", hash)).toBe(false);
      expect(await verifyPassword("CASESENSITIVE", hash)).toBe(false);
    });

    it("handles special characters correctly", async () => {
      const password = "P@$$w0rd!#$%^&*()_+-=[]{}|;':\",./<>?";
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it("handles unicode characters correctly", async () => {
      const password = "كلمةمرورقوية١٢٣";
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword("كلمةمرورقوية١٢٤", hash)).toBe(false);
    });

    it("works correctly across multiple hash-verify cycles", { timeout: 15000 }, async () => {
      const passwords = ["pass1", "P@ssw0rd!", " very spaced out ", "😂👍≡"];
      for (const pw of passwords) {
        const hash = await hashPassword(pw);
        expect(await verifyPassword(pw, hash)).toBe(true);
        expect(await verifyPassword(pw + "x", hash)).toBe(false);
      }
    });
  });
});
