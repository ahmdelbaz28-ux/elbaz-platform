// UptimeRobot: list existing monitors, then ensure the site + backend are monitored.
const KEY = process.env.UPTIMEROBOT_KEY || "";
const API = "https://api.uptimerobot.com/v2/";

async function ur(action, payload = {}) {
  const res = await fetch(API + action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ api_key: KEY, format: "json", ...payload }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const list = await ur("getMonitors");
if (list.status !== 200 || list.body.stat !== "ok") {
  console.log("LIST FAILED:", list.status, JSON.stringify(list.body).slice(0, 300));
  process.exit(1);
}
console.log(`Existing monitors: ${list.body.total ?? list.body.monitors.length}`);
for (const m of list.body.monitors) {
  const state = m.status === 2 ? "UP" : m.status === 9 ? "PAUSED" : m.status === 0 ? "paused/pending" : `status=${m.status}`;
  console.log(`  #${m.id} [${state}] ${m.friendly_name} → ${m.url} (interval=${m.interval}s, type=${m.type})`);
}
