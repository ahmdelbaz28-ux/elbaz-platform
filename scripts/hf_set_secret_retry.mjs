// Retry HF secret set with backoff until accepted (429 → wait → retry).
// Usage: node scripts/hf_set_secret_retry.mjs <key> <value>
// Both arguments come from argv — never from a publicly-writable file.
const HF_TOKEN = process.env.HF_TOKEN || "";
const SPACE = "ahmdelbaz28/AHMDRTAP";
const KEY = process.argv[2] || "";
const VALUE = process.argv[3] || "";
if (!KEY || !VALUE) {
  console.log("usage: node scripts/hf_set_secret_retry.mjs <key> <value>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");

for (let attempt = 1; attempt <= 8; attempt++) {
  const res = await fetch(`https://huggingface.co/api/spaces/${SPACE}/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key: KEY, value: VALUE }),
  });
  const body = await res.text();
  const isHtml = body.trimStart().startsWith("<");
  if (res.status === 200 && !isHtml) {
    console.log(`OK: ${safe(KEY)} set on attempt ${attempt}`);
    process.exit(0);
  }
  console.log(`attempt ${attempt}: HTTP ${safe(res.status)}${isHtml ? " (rate-limited page)" : " " + safe(body.slice(0, 120))}`);
  await sleep(45_000);
}
console.log("FAILED after retries");
process.exit(1);
