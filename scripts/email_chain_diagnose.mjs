// Diagnose the 3-service secret chain: GitHub Actions → HF Space → Resend.
// Prints a clear verdict for each link WITHOUT leaking secret values.
const GH_PAT = process.env.GH_PAT || "";
const HF_TOKEN = process.env.HF_TOKEN || "";
const RESEND_KEY = process.env.RESEND_KEY || "";
const GH_REPO = "ahmdelbaz28-ux/elbaz-platform";
const HF_SPACE = "ahmdelbaz28/AHMDRTAP";

const banner = (s) => console.log(`\n──── ${s} ────`);
// Log-injection sanitizer: strip CR/LF from any upstream-derived value.
const safe = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");

// 1) GitHub Actions secrets
banner("1) GitHub Actions secrets");
try {
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/secrets?per_page=100`, {
    headers: { Authorization: `Bearer ${GH_PAT}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    console.log(`  HTTP ${safe(res.status)} — cannot list (PAT lacks admin:repo?) body=${safe((await res.text()).slice(0, 200))}`);
  } else {
    const data = await res.json();
    const names = (data.secrets || []).map((s) => s.name);
    console.log(`  count=${safe(data.total_count ?? names.length)}`);
    for (const want of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "UPTIMEROBOT_API_KEY", "HF_TOKEN", "ADMIN_RECOVERY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "TELEGRAM_BOT_TOKEN"]) {
      console.log(`  ${names.includes(want) ? "SET " : "MISS"} ${want}`);
    }
  }
} catch (e) { console.log("  ERR", e.message); }

// 2) HF Space secrets
banner("2) HF Space secrets");
try {
  const res = await fetch(`https://huggingface.co/api/spaces/${HF_SPACE}/secrets`, {
    headers: { Authorization: `Bearer ${HF_TOKEN}` },
  });
  if (!res.ok) {
    console.log(`  HTTP ${safe(res.status)} — ${safe((await res.text()).slice(0, 200))}`);
  } else {
    const names = await res.json();
    const list = Array.isArray(names) ? names : (names.keys || []);
    console.log(`  count=${safe(list.length)}`);
    for (const want of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "UPTIMEROBOT_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "TELEGRAM_BOT_TOKEN", "ADMIN_RECOVERY"]) {
      console.log(`  ${list.includes(want) ? "SET " : "MISS"} ${want}`);
    }
  }
} catch (e) { console.log("  ERR", e.message); }

// 3) Resend: account + verified domains
banner("3) Resend account & domains");
try {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${RESEND_KEY}` },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`  HTTP ${safe(res.status)}`);
  const domains = body?.data || [];
  if (domains.length === 0) {
    console.log("  NO VERIFIED DOMAINS — sandbox mode: can only send to the account owner's email");
  }
  for (const d of domains) {
    console.log(`  domain=${safe(d.name)} status=${safe(d.status)} region=${safe(d.region)}`);
    const records = (d.records || []).map((r) => `${safe(r.record_type)}:${safe(r.status ?? "?")}`);
    if (records.length) console.log(`    dns: ${records.map(safe).join(", ")}`);
  }
} catch (e) { console.log("  ERR", e.message); }
