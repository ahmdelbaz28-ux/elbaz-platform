import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { ShieldCheck, ChevronLeft } from "lucide-react";

export default function PrivacyPolicy() {
  const { lang } = useTranslation();

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
            <ShieldCheck className="h-6 w-6 text-[#06b6d4]" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-[#f0f4f8]">
              {lang === "en" ? "Privacy Policy" : "سياسة الخصوصية"}
            </h1>
            <p className="text-sm text-[#64748b]">
              {lang === "en" ? "Last updated: May 2025" : "آخر تحديث: مايو 2025"}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-8">
          {lang === "en" ? (
            <>
              <Section title="1. Information We Collect">
                <p>We collect information that you provide directly when creating an account, including your username, name, and email address. We also collect usage data automatically, such as your course progress, quiz scores, pages visited, device information, and IP address. This data helps us improve our platform and personalize your learning experience.</p>
              </Section>

              <Section title="2. How We Use Your Information">
                <p>Your information is used to provide and improve our educational services, track your learning progress, issue certificates, process payments, communicate important updates, and ensure platform security. We never sell your personal information to third parties. Analytics data is used in aggregate form only to improve our services.</p>
              </Section>

              <Section title="3. Data Security">
                <p>We implement industry-standard security measures including encrypted connections (HTTPS/TLS), bcrypt password hashing with 12 rounds, JWT token-based authentication with automatic expiration, and rate limiting on authentication endpoints. Your payment information is processed through PCI-compliant payment gateways and is never stored on our servers.</p>
              </Section>

              <Section title="4. Video Content Protection">
                <p>Premium video content is protected using HLS encrypted streaming with dynamic forensic watermarks. Each video stream includes unique user identifiers embedded in real-time. We monitor for unauthorized distribution and employ technical measures to prevent screen recording and content downloading.</p>
              </Section>

              <Section title="5. Cookies">
                <p>We use essential cookies for authentication and session management. Optional analytics cookies help us understand platform usage patterns. Marketing cookies may be used for advertising purposes. You can manage your cookie preferences at any time through the cookie consent banner displayed on your first visit.</p>
              </Section>

              <Section title="6. Data Retention">
                <p>We retain your account data for as long as your account is active. If you request account deletion, we will remove your personal data within 30 days, except where retention is required by law. Anonymized learning analytics may be retained indefinitely for platform improvement purposes.</p>
              </Section>

              <Section title="7. Your Rights">
                <p>You have the right to access, correct, or delete your personal data at any time. You can update your profile information through your account settings. To request complete data deletion, please contact our support team. You can also export your learning data upon request.</p>
              </Section>

              <Section title="8. Third-Party Services">
                <p>We use Paymob for payment processing, which handles payment data under PCI-DSS compliance. We may use analytics services to improve our platform. These services are bound by their own privacy policies and only receive the minimum data necessary to perform their functions.</p>
              </Section>

              <Section title="9. Contact">
                <p>For privacy-related inquiries, please contact us through our <Link to="/support" className="text-[#06b6d4] hover:underline">Support Center</Link> or email privacy@ahmedelbaz.com. We will respond to your request within 14 business days.</p>
              </Section>
            </>
          ) : (
            <>
              <Section title="١. المعلومات التي نجمعها">
                <p>نجمع المعلومات التي تقدمها مباشرة عند إنشاء حساب، بما في ذلك اسم المستخدم والاسم والبريد الإلكتروني. كما نجمع بيانات الاستخدام تلقائياً مثل تقدمك في الدورات ودرجات الاختبارات والصفحات التي تزورها ومعلومات الجهاز وعنوان IP. تساعدنا هذه البيانات في تحسين المنصة وتخصيص تجربتك التعليمية.</p>
              </Section>

              <Section title="٢. كيف نستخدم معلوماتك">
                <p>تُستخدم معلوماتك لتقديم وتحسين خدماتنا التعليمية وتتبع تقدمك التعليمي وإصدار الشهادات ومعالجة المدفوعات وتواصل التحديثات المهمة وضمان أمان المنصة. لا نبيع معلوماتك الشخصية لأطراف ثالثة أبداً.</p>
              </Section>

              <Section title="٣. أمن البيانات">
                <p>نطبق إجراءات أمنية معيارية في الصناعة تشمل اتصالات مشفرة (HTTPS/TLS) وتشفير كلمات المرور بتقنية bcrypt و مصادقة JWT مع انتهاء صلاحية تلقائي وتحديد معدل الطلبات على نقاط المصادقة. معلومات الدفع تُعالج عبر بوابات متوافقة مع PCI ولا تُخزن على خوادمنا.</p>
              </Section>

              <Section title="٤. حماية محتوى الفيديو">
                <p>محتوى الفيديو المدفوع محمي بتقنية بث HLS مشفر مع علامات مائية جنائية ديناميكية. يتضمن كل بث فيديو معرفات مستخدم فريدة مدمجة في الوقت الفعلي.</p>
              </Section>

              <Section title="٥. ملفات تعريف الارتباط">
                <p>نستخدم ملفات تعريف الارتباط الأساسية للمصادقة وإدارة الجلسات. يمكنك إدارة تفضيلاتك في أي وقت من خلال شريط الموافقة على ملفات تعريف الارتباط.</p>
              </Section>

              <Section title="٦. الاحتفاظ بالبيانات">
                <p>نحتفظ ببيانات حسابك طالما كان حسابك نشطاً. إذا طلبت حذف حسابك، سنزيل بياناتك الشخصية خلال ٣٠ يوماً.</p>
              </Section>

              <Section title="٧. حقوقك">
                <p>لديك حق الوصول إلى بياناتك الشخصية وتصحيحها أو حذفها في أي وقت. يمكنك تحديث معلوماتك من خلال إعدادات حسابك. لطلب حذف البيانات بالكامل، تواصل مع فريق الدعم.</p>
              </Section>

              <Section title="٨. الخدمات الخارجية">
                <p>نستخدم Paymob لمعالجة المدفوعات وفقاً لمعايير PCI-DSS. هذه الخدمات ملزمة بسياسات الخصوصية الخاصة بها ولا تتلقى سوى الحد الأدنى من البيانات اللازمة.</p>
              </Section>

              <Section title="٩. التواصل">
                <p>للاستفسارات المتعلقة بالخصوصية، تواصل معنا عبر <Link to="/support" className="text-[#06b6d4] hover:underline">مركز الدعم</Link> أو البريد الإلكتروني privacy@ahmedelbaz.com. سنرد على طلبك خلال ١٤ يوم عمل.</p>
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
