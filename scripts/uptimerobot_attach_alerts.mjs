// 1) Attach the owner's alert contact (#8944420, a7medbaz16@gmail.com) to all
//    monitors so downtime actually notifies someone.
// 2) Re-check monitor statuses.
const KEY = process.env.UPTIMEROBOT_KEY || "";
const API = "https://api.uptimerobot.com/v2/";
const CONTACT = "8944420_0_0"; // contactID-delay(0=immediate)-recurrence(0=state change)
// Log-injection sanitizer: strip CR/LF from upstream-derived values.
const safe = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");

async function ur(action, payload = {}) {
  const res = await fetch(API + action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: KEY, format: "json", ...payload }).toString(),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const list = await ur("getMonitors");
const ids = (list.body.monitors || []).map((m) => m.id);
console.log("monitors:", ids.map(safe).join(", "));

for (const id of ids) {
  const r = await ur("editMonitor", { id: String(id), alert_contacts: CONTACT });
  console.log(`editMonitor #${safe(id)} → ${safe(r.status)} ${safe(JSON.stringify(r.body).slice(0, 120))}`);
}

// fresh status snapshot
const after = await ur("getMonitors");
const STATUS_LABELS = { 0: "paused", 1: "not-checked", 2: "UP", 8: "seems-down", 9: "DOWN" };
for (const m of after.body.monitors || []) {
  const label = STATUS_LABELS[m.status] ?? `status=${m.status}`;
  console.log(`  #${safe(m.id)} [${label}] ${safe(m.friendly_name)} alerts=${safe((m.alert_contacts || []).length)}`);
}
