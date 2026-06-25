import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { useContactSettings } from "@/hooks/useContactSettings";
import { RotateCcw, ChevronLeft, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function RefundPolicy() {
  const { lang } = useTranslation();
  const { data: contact } = useContactSettings();

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-3xl px-4 pb-20 lg:px-6">
        {/* Back */}
        <button
          onClick={() => window.history.back()}
          className="mb-6 flex items-center gap-1 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
        >
          <ChevronLeft className="h-4 w-4" />
          {lang === "en" ? "Back" : "رجوع"}
        </button>

        {/* Header */}
        <div className="mb-10 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
            <RotateCcw className="h-6 w-6 text-[#06b6d4]" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-[#f0f4f8]">
              {lang === "en" ? "Refund Policy" : "سياسة الاسترداد"}
            </h1>
            <p className="text-sm text-[#64748b]">
              {lang === "en" ? "Last updated: May 2025" : "آخر تحديث: مايو 2025"}
            </p>
          </div>
        </div>

        {/* Quick summary cards */}
        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-4 text-center">
            <Clock className="mx-auto h-8 w-8 text-[#f59e0b]" />
            <p className="mt-2 text-2xl font-bold text-[#f0f4f8]">7</p>
            <p className="text-xs text-[#64748b]">
              {lang === "en" ? "Days guarantee" : "أيام ضمان"}
            </p>
          </div>
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-[#10b981]" />
            <p className="mt-2 text-2xl font-bold text-[#f0f4f8]">100%</p>
            <p className="text-xs text-[#64748b]">
              {lang === "en" ? "Full refund" : "استرداد كامل"}
            </p>
          </div>
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-4 text-center">
            <XCircle className="mx-auto h-8 w-8 text-[#f43f5e]" />
            <p className="mt-2 text-2xl font-bold text-[#f0f4f8]">
              {lang === "en" ? "No questions" : "بدون أسئلة"}
            </p>
            <p className="text-xs text-[#64748b]">
              {lang === "en" ? "Asked" : "مطلوبة"}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-8">
          {lang === "en" ? (
            <>
              <Section title="1. 7-Day Money-Back Guarantee">
                <p>We offer a full 7-day money-back guarantee on all premium courses. If you are not satisfied with the course content for any reason, you can request a complete refund within 7 days of purchase. No questions asked — we believe in the quality of our content and want you to learn with confidence.</p>
              </Section>

              <Section title="2. Eligible Refunds">
                <p>Refunds are eligible for all premium course purchases made within the last 7 days. The course must not have been completed (progress below 50%). If you have downloaded any certificates or completed more than half the course content, the refund may be prorated or declined at our discretion. Free courses and promotional bundles are non-refundable.</p>
              </Section>

              <Section title="3. How to Request a Refund">
                <p>To request a refund, simply contact our support team through the <Link to="/support" className="text-[#06b6d4] hover:underline">Support Center</Link>. Include your order number and the reason for the refund request. Our team will process your request within 3-5 business days. Refunds are credited back to the original payment method.</p>
              </Section>

              <Section title="4. Refund Processing Time">
                <p>Once your refund request is approved, processing times vary by payment method. Credit/debit card refunds typically take 5-10 business days to appear on your statement. Mobile wallet refunds (Vodafone Cash, InstaPay) are usually processed within 1-3 business days. Bank transfers may take up to 10 business days.</p>
              </Section>

              <Section title="5. Non-Refundable Items">
                <p>The following are not eligible for refunds: free courses, promotional discounts applied after purchase, account suspension due to policy violations, and purchases older than 7 days. Bundle deals are refundable as a whole but not for individual courses within the bundle.</p>
              </Section>

              <Section title="6. Partial Access Refunds">
                <p>If you have accessed less than 25% of the course content, you are eligible for a full refund. Between 25% and 50% access, a partial refund of 50% may be issued. Beyond 50% course completion, refunds are evaluated on a case-by-case basis and are not guaranteed.</p>
              </Section>

              <Section title="7. Contact Us">
                <p>For refund inquiries, please contact our support team via <Link to="/support" className="text-[#06b6d4] hover:underline">Support Center</Link> or email <a href={`mailto:${contact.email}`} className="text-[#06b6d4] hover:underline">{contact.email}</a>. We aim to resolve all refund requests within 24 hours.</p>
              </Section>
            </>
          ) : (
            <>
              <Section title="١. ضمان استرداد لمدة ٧ أيام">
                <p>نقدم ضمان استرداد كامل للأموال لمدة ٧ أيام على جميع الدورات المدفوعة. إذا لم تكن راضياً عن محتوى الدورة لأي سبب، يمكنك طلب استرداد كامل خلال ٧ أيام من الشراء. بدون أسئلة — نؤمن بجودة محتواناً ونسعى لأن تتعلم بثقة.</p>
              </Section>

              <Section title="٢. الاستردادات المؤهلة">
                <p>الاسترداد متاح لجميع مشتريات الدورات المدفوعة خلال آخر ٧ أيام. يجب ألا يكون قد تم إكمال الدورة (التقدم أقل من ٥٠٪). الدورات المجانية والعروض الترويجية غير قابلة للاسترداد.</p>
              </Section>

              <Section title="٣. كيف تطلب استرداد">
                <p>لطلب استرداد، تواصل مع فريق الدعم عبر <Link to="/support" className="text-[#06b6d4] hover:underline">مركز الدعم</Link>. أرفق رقم الطلب وسبب طلب الاسترداد. سيعالج فريقنا طلبك خلال ٣-٥ أيام عمل. يُرد المبلغ بنفس طريقة الدفع الأصلية.</p>
              </Section>

              <Section title="٤. مدة معالجة الاسترداد">
                <p>بعد الموافقة على طلب الاسترداد، تختلف مدة المعالجة حسب طريقة الدفع. استرداد بطاقات الائتمان/الخصم يستغرق عادة ٥-١٠ أيام عمل. المحافظ الإلكترونية وفودافون كاش تتم خلال ١-٣ أيام عمل.</p>
              </Section>

              <Section title="٥. العناصر غير القابلة للاسترداد">
                <p>غير مؤهل للاسترداد: الدورات المجانية، المشتريات الأقدم من ٧ أيام، إيقاف الحساب بسبب مخالفات. الباقات الترويجية قابلة للاسترداد كاملة لكن ليس لدورة فردية ضمن الباقة.</p>
              </Section>

              <Section title="٦. الاسترداد الجزئي">
                <p>إذا وصلت لأقل من ٢٥٪ من المحتوى، أنت مؤهل لاسترداد كامل. بين ٢٥٪ و٥٠٪، قد يُصدر استرداد جزئي بنسبة ٥٠٪. بعد ٥٠٪، يُقيّم الطلب كل حالة على حدة.</p>
              </Section>

              <Section title="٧. تواصل معنا">
                <p>للاستفسارات عن الاسترداد، تواصل معنا عبر <Link to="/support" className="text-[#06b6d4] hover:underline">مركز الدعم</Link> أو <a href={`mailto:${contact.email}`} className="text-[#06b6d4] hover:underline">{contact.email}</a>. نهدف لحل جميع طلبات الاسترداد خلال ٢٤ ساعة.</p>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold text-[#f0f4f8]">{title}</h2>
      <div className="text-sm leading-relaxed text-[#94a3b8]">{children}</div>
    </section>
  );
}
