// 1) Attach the owner's alert contact (#8944420, a7medbaz16@gmail.com) to all
//    monitors so downtime actually notifies someone.
// 2) Re-check monitor statuses.
const KEY = process.env.UPTIMEROBOT_KEY || "";
const API = "https://api.uptimerobot.com/v2/";
const CONTACT = "8944420_0_0"; // contactID-delay(0=immediate)-recurrence(0=state change)

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
console.log("monitors:", ids.join(", "));

for (const id of ids) {
  const r = await ur("editMonitor", { id: String(id), alert_contacts: CONTACT });
  console.log(`editMonitor #${id} → ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}

// fresh status snapshot
const after = await ur("getMonitors");
for (const m of after.body.monitors || []) {
  const label = { 0: "paused", 1: "not-checked", 2: "UP", 8: "seems-down", 9: "DOWN" }[m.status] || m.status;
  console.log(`  #${m.id} [${label}] ${m.friendly_name} alerts=${(m.alert_contacts || []).length}`);
}
