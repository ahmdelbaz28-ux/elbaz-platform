import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { useContactSettings } from "@/hooks/useContactSettings";
import { FileText, ChevronLeft } from "lucide-react";

export default function TermsOfService() {
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
            <FileText className="h-6 w-6 text-[#06b6d4]" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-[#f0f4f8]">
              {lang === "en" ? "Terms of Service" : "شروط وأحكام الاستخدام"}
            </h1>
            <p className="text-sm text-[#64748b]">
              {lang === "en" ? "Last updated: May 2025" : "آخر تحديث: مايو 2025"}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="prose-custom space-y-8">
          {lang === "en" ? (
            <>
              <Section title="1. Acceptance of Terms">
                <p>By accessing and using the Elbaz Engineering Platform ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use our services. These terms apply to all visitors, users, students, and administrators of the Platform.</p>
              </Section>

              <Section title="2. Description of Services">
                <p>The Platform provides online engineering education courses, including but not limited to electrical power system design, protection coordination, and industrial automation courses. Course content includes video lectures, quizzes, practical exercises, and certificate programs. All content is created and owned by Eng. Ahmed Elbaz.</p>
              </Section>

              <Section title="3. User Accounts">
                <p>You must create an account to access premium content and track your progress. You are responsible for maintaining the confidentiality of your account credentials. You agree to provide accurate information during registration and to update it when necessary. Account sharing is strictly prohibited and may result in immediate termination.</p>
              </Section>

              <Section title="4. Intellectual Property">
                <p>All course content, including videos, text, graphics, logos, and software, is the exclusive property of Eng. Ahmed Elbaz and is protected by international copyright laws. Unauthorized reproduction, distribution, or modification of any content is strictly prohibited. Violations may result in legal action and permanent account termination.</p>
              </Section>

              <Section title="5. Payments and Refunds">
                <p>Course prices are listed in Egyptian Pounds (EGP) and include applicable taxes. Payment is processed through authorized payment gateways including Paymob, Visa/Mastercard, InstaPay, Vodafone Cash, and other supported methods. We offer a 7-day money-back guarantee for all premium courses if the content does not meet your expectations.</p>
              </Section>

              <Section title="6. Content Protection">
                <p>Our platform employs content protection measures including secure streaming, access controls, and user-identifiable watermarks to protect premium content. Screen recording, downloading, and unauthorized sharing of course materials is strictly prohibited. Detected violations will result in immediate account suspension and potential legal proceedings.</p>
              </Section>

              <Section title="7. Certificates">
                <p>Certificates are awarded upon successful completion of course requirements, including passing all required quizzes with minimum scores. Certificates are digital documents with unique verification codes. While certificates demonstrate course completion, they do not constitute professional licensing or accreditation.</p>
              </Section>

              <Section title="8. Limitation of Liability">
                <p>The Platform provides educational content for informational and professional development purposes. While we strive for accuracy, we make no warranties regarding the completeness or reliability of the content. We are not liable for any decisions made based on the course material. Users should always verify technical information with official standards and regulations.</p>
              </Section>

              <Section title="9. Contact">
                <p>For any questions regarding these Terms of Service, please contact us through our <Link to="/support" className="text-[#06b6d4] hover:underline">Support Center</Link> or via email at <a href={`mailto:${contact.email}`} className="text-[#06b6d4] hover:underline">{contact.email}</a>.</p>
              </Section>
            </>
          ) : (
            <>
              <Section title="١. قبول الشروط">
                <p>باستخدامك لمنصة م. أحمد الباز للهندسة الكهربية ("المنصة")، فإنك توافق على الالتزام بشروط وأحكام الاستخدام هذه. إذا كنت لا توافق على أي جزء من هذه الشروط، يرجى عدم استخدام خدماتنا. تنطبق هذه الشروط على جميع الزوار والمستخدمين والطلاب.</p>
              </Section>

              <Section title="٢. وصف الخدمات">
                <p>توفر المنصة دورات تعليمية هندسية عبر الإنترنت تشمل تصميم أنظمة القوى الكهربية وتنسيق الحماية والأتمتة الصناعية. يتضمن المحتوى محاضرات فيديو واختبارات وتمارين عملية وبرامج شهادات. جميع المحتويات من إعداد وملكية م. أحمد الباز.</p>
              </Section>

              <Section title="٣. حسابات المستخدمين">
                <p>يجب إنشاء حساب للوصول للمحتوى المدفوع وتتبع تقدمك. أنت مسؤول عن الحفاظ على سرية بيانات حسابك. يُحظر مشاركة الحساب مع الآخرين وقد يؤدي ذلك إلى إيقاف الحساب فوراً.</p>
              </Section>

              <Section title="٤. الملكية الفكرية">
                <p>جميع محتويات الدورات بما في ذلك الفيديوهات والنصوص والرسومات محمية بموجب قوانين حقوق النشر الدولية. يُمنع منعاً باتاً إعادة إنتاج المحتوى أو توزيعه أو تعديله دون إذن كتابي. قد تؤدي المخالفات إلى إجراءات قانونية.</p>
              </Section>

              <Section title="٥. المدفوعات والاسترداد">
                <p>أسعار الدورات معروضة بالجنيه المصري وتشمل الضرائب المطبقة. نقبل الدفع عبر بطاقات Visa/Mastercard وInstaPay وفودافون كاش وغيرها. نقدم ضمان استرداد الأموال لمدة ٧ أيام لجميع الدورات المدفوعة.</p>
              </Section>

              <Section title="٦. حماية المحتوى">
                <p>تستخدم المنصة تقنيات متقدمة لإدارة الحقوق الرقمية لحماية المحتوى. يُمنع تصوير الشاشة وتنزيل ومشاركة المواد التعليمية. المخالفات المكتشفة ستؤدي إلى إيقاف الحساب وإجراءات قانونية.</p>
              </Section>

              <Section title="٧. الشهادات">
                <p>تُمنح الشهادات عند إتمام متطلبات الدورة بنجاح بما في ذلك اجتياز جميع الاختبارات. الشهادات عبارة عن مستندات رقمية بأكواد تحقق فريدة. الشهادات تثبت إتمام الدورة لكنها لا تُعد ترخيصاً مهنياً.</p>
              </Section>

              <Section title="٨. مسؤولية محدودة">
                <p>توفر المنصة محتوى تعليمي لأغراض التطوير المهني. رغم سعينا للدقة، لا نقدم ضمانات بشأن اكتمال أو دقة المحتوى. لسنا مسؤولين عن أي قرارات تُتخذ بناءً على مادة الدورة.</p>
              </Section>

              <Section title="٩. التواصل">
                <p>لأي أسئلة بخصوص شروط الاستخدام، يرجى التواصل معنا عبر <Link to="/support" className="text-[#06b6d4] hover:underline">مركز الدعم</Link> أو عبر البريد الإلكتروني <a href={`mailto:${contact.email}`} className="text-[#06b6d4] hover:underline">{contact.email}</a>.</p>
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
