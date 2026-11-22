// Set ADMIN_RECOVERY on the HF Space (the db-init rotation lever).
// Usage: node scripts/hf_set_admin_recovery.mjs <value>
// The value comes from argv — never from a file in a publicly-writable dir.
const HF_TOKEN = process.env.HF_TOKEN || "";
const SPACE = "ahmdelbaz28/AHMDRTAP";
const PASSWORD = process.argv[2] || "";
if (!PASSWORD) {
  console.log("usage: node scripts/hf_set_admin_recovery.mjs <value>");
  process.exit(1);
}

const res = await fetch(`https://huggingface.co/api/spaces/${SPACE}/secrets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ key: "ADMIN_RECOVERY", value: PASSWORD }),
});
const safe = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");
console.log(`set ADMIN_RECOVERY → HTTP ${safe(res.status)}`);
const body = await res.text();
if (body.trim().startsWith("{")) console.log(safe(body.slice(0, 200)));
