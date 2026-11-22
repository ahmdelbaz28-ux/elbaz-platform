// Fix the DOWN version monitor: point at the HF origin (bypasses qzz.io edge
// challenge), keep the buildId keyword, and confirm it comes UP.
const KEY = process.env.UPTIMEROBOT_KEY || "";
const API = "https://api.uptimerobot.com/v2/";

async function ur(action, payload = {}) {
  const res = await fetch(API + action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: KEY, format: "json", ...payload }).toString(),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Sanity: the new target must actually contain the keyword.
const probe = await fetch("https://ahmdelbaz28-ahmdrtap.hf.space/api/version");
const probeBody = await probe.text();
const okTarget = probe.status === 200 && probeBody.includes("buildId");
console.log(`target probe: status=${probe.status} containsBuildId=${probeBody.includes("buildId")}`);
if (!okTarget) {
  console.log("ABORT: target does not serve the keyword right now");
  process.exit(1);
}

const upd = await ur("editMonitor", {
  id: "804768552",
  url: "https://ahmdelbaz28-ahmdrtap.hf.space/api/version",
  friendly_name: "Elbaz Platform — Build Version Token (origin)",
});
console.log("editMonitor:", upd.status, JSON.stringify(upd.body).slice(0, 200));
