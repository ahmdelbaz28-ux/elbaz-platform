/**
 * LOG-ATTACHED PROBE — proves the owner alert email was ACCEPTED by Resend
 * (production). Strategy: attach to the HF Space runtime log SSE stream
 * FIRST, then trigger a fresh probe registration while attached. The server
 * log line "[Approval] alert email sent" (userId + masked recipient) must
 * appear in the stream within seconds of the registration — that line is
 * logged ONLY after the Resend API call returned ok:true for the message to
 * ADMIN_ALERT_EMAIL (ahmdelbaz28@gmail.com).
 *
 * Exit 0 = send line observed. Exit 1 = no line within the window.
 */
const SPACE = "ahmdelbaz28/ahmdrtap";
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const HF_TOKEN = process.env.HF_TOKEN || "";

const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

const STAMP = new Date().toISOString().slice(5, 10).replace("-", "");
const USERNAME = `gate_probe2_${STAMP}`;
const PASSWORD = `Probe${STAMP}bB8${Math.random().toString(36).slice(2, 8)}`;

const stream = await fetch(`https://huggingface.co/api/spaces/${SPACE}/logs/run`, {
  headers: { Authorization: `Bearer ${HF_TOKEN}` },
  signal: AbortSignal.timeout(95_000),
});
console.log("log stream status:", stream.status, stream.headers.get("content-type") ?? "");
if (!stream.ok || !stream.body) {
  console.log("logs stream unavailable — cannot attach");
  process.exit(2);
}

// Read the SSE stream in the background, buffering lines.
const reader = (stream.body as unknown as ReadableStream<Uint8Array>).getReader();
const dec = new TextDecoder();
let buf = "";
let seen = "";
const streamDone = (async () => {
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (const line of buf.split("\n")) {
        if (/alert email (sent|failed)|alert email failed|Email\/Resend|fan-out pushed/.test(line)) {
          seen += line.trim().slice(0, 220) + "\n";
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    }
  } catch { /* stream ended */ }
})();

// Give the stream a moment to attach, then trigger the registration.
await new Promise((r) => setTimeout(r, 4000));
console.log("triggering registration:", USERNAME);
const t0 = Date.now();
const res = await fetch(`${BASE}/api/trpc/auth.register`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ json: { username: USERNAME, password: PASSWORD, name: "Log Probe", email: "" } }),
  signal: AbortSignal.timeout(60_000),
});
const body = await res.text();
console.log("register status:", res.status, body.slice(0, 140));

// Watch the stream for up to 60s after the trigger.
const deadline = Date.now() + 60_000;
while (Date.now() < deadline && seen === "") {
  await new Promise((r) => setTimeout(r, 2000));
}
reader.cancel().catch(() => {});

const sent = seen.includes("alert email sent");
const failed = seen.includes("alert email failed") || seen.includes("Email/Resend");
console.log("--- observed log lines ---");
console.log(seen.trim() || "(none)");
if (sent && !failed) {
  console.log("PASS: Resend accepted the owner alert email (send line observed live)");
  process.exit(0);
}
if (failed) {
  console.log("FAIL: email failure line observed");
  process.exit(1);
}
console.log("FAIL: no alert-email line within window");
process.exit(1);
