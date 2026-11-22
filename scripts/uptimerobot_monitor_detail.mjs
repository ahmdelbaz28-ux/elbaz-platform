// Inspect one monitor's full config, then optionally resume + fix keyword.
const KEY = process.env.UPTIMEROBOT_KEY || "";
const ID = process.env.MONITOR_ID || "";
const API = "https://api.uptimerobot.com/v2/";

async function ur(action, payload = {}) {
  const res = await fetch(API + action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: KEY, format: "json", ...payload }).toString(),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const det = await ur("getMonitors", { monitors: ID });
for (const m of det.body.monitors || []) {
  console.log(JSON.stringify({ id: m.id, name: m.friendly_name, url: m.url, type: m.type, status: m.status, interval: m.interval, keyword: m.keyword_keyword_value ?? m.keyword_value ?? null, keywordCase: m.keyword_case_type, timeout: m.timeout, alerts: (m.alert_contacts || []).length, createAlertContact: m.create_alert_contact_enabled }, null, 2));
}
