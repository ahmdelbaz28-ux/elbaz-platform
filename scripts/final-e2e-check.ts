/** FINAL E2E — fresh logged-in user sees the real new-episode notification. */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

const stamp = Date.now().toString(36);
const USERNAME = `final${stamp}`.slice(0, 20);
const PASSWORD = `Final${stamp}Pass1`;

function cookieFrom(res: Response, jar: string[]): void {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const name = pair.split("=")[0];
    const idx = jar.findIndex((c) => c.startsWith(name + "="));
    if (idx >= 0) jar.splice(idx, 1);
    jar.push(pair);
  }
}

async function mut(proc: string, input: unknown, jar: string[]) {
  const res = await fetch(`${BASE}/api/trpc/${proc}?batch=1`, {
    method: "POST",
    headers: { ...H, ...(jar.length ? { Cookie: jar.join("; ") } : {}) },
    body: JSON.stringify({ 0: { json: input } }),
  });
  cookieFrom(res, jar);
  return res.status;
}

const jar: string[] = [];
console.log("register:", await mut("auth.register", { username: USERNAME, password: PASSWORD, name: "final check" }, jar));
console.log("login:", await mut("auth.login", { username: USERNAME, password: PASSWORD, remember: true }, jar));

const poll = await fetch(`${BASE}/api/notifications/poll`, { headers: { ...H, Cookie: jar.join("; ") } });
const body = (await poll.json()) as {
  events: Array<{ id: string; type: string; title: string; message: string; url?: string; createdAt: string }>;
};
console.log("\npoll:", poll.status, "events:", body.events?.length);
for (const ev of body.events ?? []) {
  console.log(`  [${ev.type}] ${ev.createdAt}`);
  console.log(`   title: ${ev.title}`);
  console.log(`   url:   ${ev.url ?? "-"}`);
  console.log(`   msg:   ${ev.message.slice(0, 80)}...`);
}
const yt = (body.events ?? []).find((e) => e.type === "youtube");
console.log("\nRESULT:", yt ? "PASS — logged-in user receives the new-episode notification ✓" : "FAIL — no youtube event");
process.exit(yt ? 0 : 1);
