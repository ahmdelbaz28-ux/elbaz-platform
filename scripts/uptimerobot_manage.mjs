// UptimeRobot: list existing monitors with status labels (read-only helper).
// NOTE: actions are a fixed allowlist — no dynamic URL construction.
const KEY = process.env.UPTIMEROBOT_KEY || "";
const API = "https://api.uptimerobot.com/v2/";

const ACTIONS = {
  getMonitors: `${API}getMonitors`,
};

async function ur(action, payload = {}) {
  const url = ACTIONS[action];
  if (!url) throw new Error(`unknown action ${action}`);
  const res = await fetch(url, {
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
const STATUS_LABELS = { 2: "UP", 9: "DOWN", 0: "paused/pending", 1: "not-checked", 8: "seems-down" };
const safe = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");
console.log(`Existing monitors: ${safe(list.body.total ?? list.body.monitors.length)}`);
for (const m of list.body.monitors) {
  const state = STATUS_LABELS[m.status] ?? `status=${m.status}`;
  console.log(`  #${safe(m.id)} [${state}] ${safe(m.friendly_name)} → ${safe(m.url)} (interval=${safe(m.interval)}s, type=${safe(m.type)})`);
}
