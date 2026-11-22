// Retry HF secret set with backoff until accepted (429 → wait → retry).
import fs from "node:fs";

const HF_TOKEN = process.env.HF_TOKEN || "";
const SPACE = "ahmdelbaz28/AHMDRTAP";
const PASSWORD = fs.readFileSync("/tmp/admin_pass.txt", "utf8").trim();
const KEY = process.argv[2] || "ADMIN_RECOVERY";
const VALUE = process.argv[3] || PASSWORD;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let attempt = 1; attempt <= 8; attempt++) {
  const res = await fetch(`https://huggingface.co/api/spaces/${SPACE}/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key: KEY, value: VALUE }),
  });
  const body = await res.text();
  const isHtml = body.trimStart().startsWith("<");
  if (res.status === 200 && !isHtml) {
    console.log(`OK: ${KEY} set on attempt ${attempt}`);
    process.exit(0);
  }
  console.log(`attempt ${attempt}: HTTP ${res.status}${isHtml ? " (rate-limited page)" : " " + body.slice(0, 120)}`);
  await sleep(45_000);
}
console.log("FAILED after retries");
process.exit(1);
