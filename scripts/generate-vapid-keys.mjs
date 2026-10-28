#!/usr/bin/env node
/**
 * Generate a VAPID key pair for Web Push.
 *
 * VAPID keys are SELF-ISSUED (a P-256 key pair) — not a third-party API key.
 * Generate ONCE, then set as deployment env secrets:
 *
 *   VAPID_PUBLIC_KEY  — served to browsers via /api/notifications/push/public-key
 *   VAPID_PRIVATE_KEY — server secret, never exposed
 *   VAPID_SUBJECT     — optional mailto: contact (defaults to the platform's)
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("── Web Push VAPID keys (generate ONCE, reuse everywhere) ──\n");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("\nSet both as secrets on the deployment (HF Space / Docker env).\n");
console.log("Rotate only when needed — rotating invalidates every existing");
console.log("browser subscription (the push services reject the new key).");
