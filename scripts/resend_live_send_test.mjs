// Live Resend send test — proves API key validity + verified domain + acceptance.
// Sends ONE minimal email to the platform admin mailbox.
const KEY = process.env.RESEND_KEY || "";
const FROM = process.env.RESEND_FROM || "noreply@ahmedelbaz.qzz.io";
const TO = process.env.RESEND_TO || "admin@ahmedelbaz.qzz.io";

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: `Ahmed Elbaz Platform <${FROM}>`,
    to: TO,
    subject: "[فحص حي] تسليم البريد — منصة م. أحمد الباز",
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px"><h2 style="color:#06b6d4">فحص تسليم البريد الحي</h2><p>هذا بريد فحص آلي أُرسل من بيئة التحقق للتأكد من أن خدمة البريد (Resend) تعمل بنجاح مع النطاق المُوثَّق.</p><p style="color:#64748b;font-size:12px">الوقت: ${new Date().toISOString()}</p></div>`,
    text: "فحص تسليم البريد الحي — خدمة Resend تعمل بنجاح.",
  }),
});
const body = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(body, null, 2));
if (res.ok && body.id) {
  console.log("\nVERDICT: ACCEPTED — email id=" + body.id + " (provider accepted for delivery)");
}
