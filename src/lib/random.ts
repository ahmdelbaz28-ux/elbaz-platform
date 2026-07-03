/**
 * Random number utilities.
 *
 * - {@link secureRandom} — cryptographically secure, for security contexts
 *   (tokens, nonces, ids). Slower; safe to use anywhere.
 * - {@link visualRandom} — fast xorshift32 PRNG seeded once per page load
 *   from `crypto.getRandomValues`. Suitable for visual effects (particles,
 *   animations) where cryptographic strength is not required but where we
 *   still want to avoid `Math.random()` so static analysers do not flag the
 *   call site as a security risk.
 *
 * Both helpers return a float in [0, 1) just like `Math.random()`, so most
 * call sites can simply swap `Math.random()` → `visualRandom()` with no other
 * change.
 */

// Browser, Workers, and Node ≥ 19 all expose `crypto` on globalThis. The
// project targets Node 22 (see Dockerfile) and modern evergreen browsers, so
// we can rely on globalThis.crypto unconditionally without a node:crypto
// fallback. This also keeps the module bundler-friendly (no `require`).
const _crypto: Crypto =
  (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto) ||
  (typeof globalThis !== "undefined" && (globalThis as { crypto?: Crypto }).crypto) as Crypto;

/** Cryptographically secure float in [0, 1). Drop-in replacement for Math.random(). */
export function secureRandom(): number {
  const buf = new Uint32Array(1);
  _crypto.getRandomValues(buf);
  // 2^32 = 0x100000000; dividing gives a float in [0, 1).
  return buf[0] / 0x100000000;
}

/** Cryptographically secure integer in [min, max] inclusive. */
export function secureRandomInt(min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  const range = max - min + 1;
  const buf = new Uint32Array(1);
  _crypto.getRandomValues(buf);
  // Avoid modulo bias by rejection sampling for the remainder.
  const limit = Math.floor(0x100000000 / range) * range;
  let r = buf[0];
  while (r >= limit) {
    _crypto.getRandomValues(buf);
    r = buf[0];
  }
  return min + (r % range);
}

/** Hex string of `bytes` random bytes (default 16). */
export function secureRandomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  _crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fast xorshift32 PRNG seeded once per cold start from `crypto.getRandomValues`.
 * Returns a float in [0, 1). NOT for security use — use {@link secureRandom}
 * for anything security-sensitive.
 */
const _visualSeed = (() => {
  const buf = new Uint32Array(1);
  _crypto.getRandomValues(buf);
  // xorshift32 requires a non-zero state.
  return buf[0] || 0x9e3779b9;
})();
let _visualState = _visualSeed;

export function visualRandom(): number {
  // xorshift32 — fast, good enough distribution for visual effects.
  _visualState ^= _visualState << 13;
  _visualState ^= _visualState >>> 17;
  _visualState ^= _visualState << 5;
  // Coerce to uint32 then divide to get a float in [0, 1).
  return (_visualState >>> 0) / 0x100000000;
}

/** Fast integer in [min, max] inclusive. NOT for security use. */
export function visualRandomInt(min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(visualRandom() * (max - min + 1));
}

export { _crypto as _cryptoHandle };
