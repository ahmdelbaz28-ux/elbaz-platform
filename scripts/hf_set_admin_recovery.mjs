// Set ADMIN_RECOVERY on the HF Space to the generated password.
// On the next Space boot, db-init CLAIMS the lever: backs up the current
// admin hash, installs the recovery hash. Then we verify login, and finally
// set ADMIN_RECOVERY=done to disarm.
import fs from "node:fs";

const HF_TOKEN = process.env.HF_TOKEN || "";
const SPACE = "ahmdelbaz28/AHMDRTAP";
const PASSWORD = fs.readFileSync("/tmp/admin_pass.txt", "utf8").trim();

const res = await fetch(`https://huggingface.co/api/spaces/${SPACE}/secrets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ key: "ADMIN_RECOVERY", value: PASSWORD }),
});
console.log(`set ADMIN_RECOVERY → HTTP ${res.status}`);
const body = await res.text();
if (body.trim()) console.log(body.slice(0, 200));
