import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { isValidEmail } from "@/lib/validation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  User,
  Mail,
  Shield,
  Calendar,
  Edit3,
  Save,
  X,
  Lock,
  Eye,
  EyeOff,
  Award,
  GraduationCap,
  Zap,
  CheckCircle2,
  AlertTriangle,
  MailCheck,
  MailWarning,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Profile() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/login");
  }, [isLoading, isAuthenticated, navigate]);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      toast.success(lang === "en" ? "Profile updated successfully" : "تم تحديث الملف الشخصي بنجاح");
      setIsEditing(false);
      globalThis.location.reload();
    },
    onError: (err) => toast.error(err.message),
  });

  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success(lang === "en" ? "Password changed successfully. Please login again." : "تم تغيير كلمة المرور بنجاح. يرجى تسجيل الدخول مرة أخرى.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowChangePassword(false);
      setTimeout(() => logout(), 2000);
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: myEnrollments } = trpc.course.enrollments.useQuery(undefined, { enabled: isAuthenticated });
  const { data: myCertificates } = trpc.certificate.myCertificates.useQuery(undefined, { enabled: isAuthenticated });

  const sendVerificationMutation = trpc.auth.sendVerificationEmail.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || (lang === "en" ? "Verification email sent!" : "تم إرسال بريد التحقق!"));
      setCooldown(60);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleStartEdit = () => {
    setEditName(user?.name || "");
    setEditEmail(user?.email || "");
    setIsEditing(true);
  };

  const handleSaveProfile = () => {
    if (!editName.trim()) { toast.error(lang === "en" ? "Name is required" : "الاسم مطلوب"); return; }
    if (editEmail.trim() && !isValidEmail(editEmail)) { toast.error(lang === "en" ? "Invalid email format" : "صيغة البريد الإلكتروني غير صحيحة"); return; }
    updateProfileMutation.mutate({ name: editName.trim(), email: editEmail.trim() || undefined });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) { toast.error(lang === "en" ? "Please fill in all fields" : "يرجى ملء جميع الحقول"); return; }
    if (newPassword.length < 8) { toast.error(lang === "en" ? "New password must be at least 8 characters" : "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل"); return; }
    if (newPassword !== confirmNewPassword) { toast.error(lang === "en" ? "Passwords do not match" : "كلمات المرور غير متطابقة"); return; }
    if (currentPassword === newPassword) { toast.error(lang === "en" ? "New password must be different from current password" : "كلمة المرور الجديدة يجب أن تختلف عن الحالية"); return; }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-accent-secondary" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString(locale, { year: "numeric", month: "long" }) : "—";
  const roleLabel = user.role === "admin" ? (lang === "en" ? "Administrator" : "مدير") : (lang === "en" ? "Student" : "طالب");
  const cooldownSendLabel = lang === "en" ? `Resend in ${cooldown}s` : `إعادة الإرسال بعد ${cooldown}ث`;
  const sendVerificationLabel = lang === "en" ? "Send Verification Email" : "أرسل بريد التأكيد";
  const verificationButtonLabel = cooldown > 0 ? cooldownSendLabel : sendVerificationLabel;
  const cooldownOrSendIcon = cooldown > 0 ? <span className="text-xs">{cooldown}s</span> : <Send className="h-4 w-4" />;
  const verificationButtonIcon = sendVerificationMutation.isPending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> : cooldownOrSendIcon;

  return (
    <div className="min-h-screen bg-background pt-24">
      <div className="mx-auto max-w-4xl px-4 pb-20 lg:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">{t("myProfile")}</h1>
          <p className="mt-1 text-sm text-text-muted">{lang === "en" ? "Manage your account settings and preferences" : "إدارة إعدادات حسابك وتفضيلاتك"}</p>
        </div>

        <div className="mb-6 rounded-xl border border-border bg-primary p-8">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <div className="relative">
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-secondary to-accent text-4xl font-bold text-background shadow-[0_0_32px_rgba(6,182,212,0.3)]">
                {(user.name || user.username || "U").charAt(0).toUpperCase()}
              </div>
              {user.role === "admin" && (
                <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary bg-amber-500">
                  <Shield className="h-3.5 w-3.5 text-background" />
                </div>
              )}
            </div>

            <div className="flex-1 text-center sm:text-start">
              <h2 className="text-2xl font-bold text-foreground">{user.name || user.username}</h2>
              <p className="mt-1 text-sm text-accent-secondary">@{user.username}</p>
              {user.email && (
                <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-text-muted sm:justify-start">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="flex items-center gap-1 rounded-full bg-accent-secondary/10 px-3 py-1 text-xs font-medium text-accent-secondary">
                  <User className="h-3 w-3" />
                  {roleLabel}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
                  <Calendar className="h-3 w-3" />
                  {lang === "en" ? "Joined" : "انضم"} {memberSince}
                </span>
              </div>
            </div>

            {!isEditing && (
              <Button onClick={handleStartEdit} className="gap-2 border border-border bg-transparent text-text-muted hover:border-accent-secondary hover:text-accent-secondary">
                <Edit3 className="h-4 w-4" />
                {t("editProfile")}
              </Button>
            )}
          </div>
        </div>

        {user.email && (
          <div className="mb-6 rounded-xl border border-border bg-primary p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {user.emailVerifiedAt ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                    <MailCheck className="h-5 w-5 text-emerald-500" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                    <MailWarning className="h-5 w-5 text-amber-500" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">{lang === "en" ? "Email Verification" : "التحقق من البريد الإلكتروني"}</p>
                  {user.emailVerifiedAt ? (
                    <>
                      <p className="mt-0.5 text-xs text-emerald-500">{lang === "en" ? "Verified" : "موثق"}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">{new Date(user.emailVerifiedAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
                    </>
                  ) : (
                    <p className="mt-0.5 text-xs text-amber-500">{lang === "en" ? "Your email is not verified yet" : "بريدك الإلكتروني غير موثق بعد"}</p>
                  )}
                </div>
              </div>

              {!user.emailVerifiedAt && (
                <Button onClick={() => sendVerificationMutation.mutate()} disabled={sendVerificationMutation.isPending || cooldown > 0} className="gap-2 shrink-0 bg-gradient-to-r from-accent-secondary to-accent-secondary/80 text-background font-semibold">
                  {verificationButtonIcon}
                  {verificationButtonLabel}
                </Button>
              )}
            </div>
          </div>
        )}

        {isEditing && (
          <div className="mb-6 rounded-xl border border-accent-secondary/30 bg-primary p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
              <Edit3 className="h-5 w-5 text-accent-secondary" />
              {t("editProfile")}
            </h3>
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-text-muted">{t("name")}</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("enterName")} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
              </div>
              <div>
                <Label className="text-sm text-text-muted">{t("email")}</Label>
                <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder={t("enterEmail")} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
              </div>
              <div className="flex gap-3">
                <Button onClick={handleSaveProfile} disabled={updateProfileMutation.isPending} className="gap-2 bg-gradient-to-r from-accent-secondary to-accent-secondary/80 text-background font-semibold">
                  {updateProfileMutation.isPending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> : <Save className="h-4 w-4" />}
                  {t("save")}
                </Button>
                <Button onClick={() => setIsEditing(false)} variant="ghost" className="gap-2 text-text-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                  {t("cancel")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-primary p-5 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-secondary/10">
              <GraduationCap className="h-5 w-5 text-accent-secondary" />
            </div>
            <p className="text-2xl font-bold text-foreground">{myEnrollments?.length || 0}</p>
            <p className="mt-1 text-xs text-text-muted">{lang === "en" ? "Enrolled Courses" : "كورسات مسجل بها"}</p>
          </div>
          <div className="rounded-xl border border-border bg-primary p-5 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Award className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-foreground">{myCertificates?.length || 0}</p>
            <p className="mt-1 text-xs text-text-muted">{t("myCertificates")}</p>
          </div>
          <div className="rounded-xl border border-border bg-primary p-5 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Zap className="h-5 w-5 text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-foreground">{user.role === "admin" ? "Admin" : "Student"}</p>
            <p className="mt-1 text-xs text-text-muted">{lang === "en" ? "Account Level" : "مستوى الحساب"}</p>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-border bg-primary p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Lock className="h-5 w-5 text-accent-secondary" />
              {t("securitySettings")}
            </h3>
            {!showChangePassword && (
              <Button onClick={() => setShowChangePassword(true)} variant="outline" size="sm" className="gap-2 border-border text-text-muted hover:border-accent-secondary hover:text-accent-secondary">
                <Lock className="h-3.5 w-3.5" />
                {t("changePassword")}
              </Button>
            )}
          </div>

          {!showChangePassword && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-background p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">{lang === "en" ? "Password Protection" : "حماية كلمة المرور"}</p>
                  <p className="text-xs text-text-muted">{lang === "en" ? "Your account is secured with an encrypted password (bcrypt)" : "حسابك محمي بكلمة مرور مشفرة (bcrypt)"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-background p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">{lang === "en" ? "JWT Authentication" : "مصادقة JWT"}</p>
                  <p className="text-xs text-text-muted">{lang === "en" ? "Secure token-based authentication with automatic expiration" : "مصادقة آمنة بالرمز مع انتهاء صلاحية تلقائي"}</p>
                </div>
              </div>
            </div>
          )}

          {showChangePassword && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <Label className="text-sm text-text-muted">{lang === "en" ? "Current Password" : "كلمة المرور الحالية"}</Label>
                <div className="relative mt-1">
                  <Input type={showCurrentPassword ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={lang === "en" ? "Enter current password" : "أدخل كلمة المرور الحالية"} className="border-border bg-background pr-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
                  <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-sm text-text-muted">{lang === "en" ? "New Password" : "كلمة المرور الجديدة"}</Label>
                <div className="relative mt-1">
                  <Input type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={lang === "en" ? "Enter new password (min 8 chars)" : "أدخل كلمة المرور الجديدة (8 أحرف على الأقل)"} className="border-border bg-background pr-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPassword.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((level) => {
                        const strength = getNewPasswordStrength(newPassword);
                        const isActive = level <= strength;
                        const barColor = isActive ? (strength <= 1 ? "bg-destructive" : strength <= 2 ? "bg-amber-500" : strength <= 3 ? "bg-accent-secondary" : "bg-emerald-500") : "bg-border";
                        return <div key={level} className={`h-1 flex-1 rounded-full transition-all ${barColor}`} />;
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">{getNewPasswordStrengthLabel(newPassword, lang)}</p>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-sm text-text-muted">{lang === "en" ? "Confirm New Password" : "تأكيد كلمة المرور الجديدة"}</Label>
                <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder={lang === "en" ? "Confirm new password" : "أكد كلمة المرور الجديدة"} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
                {confirmNewPassword && newPassword !== confirmNewPassword && <p className="mt-1 text-xs text-destructive">{lang === "en" ? "Passwords do not match" : "كلمات المرور غير متطابقة"}</p>}
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 border border-amber-500/20 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-500">{lang === "en" ? "After changing your password, you will be logged out and need to sign in again." : "بعد تغيير كلمة المرور، سيتم تسجيل خروجك وستحتاج لتسجيل الدخول مرة أخرى."}</p>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={changePasswordMutation.isPending} className="gap-2 bg-gradient-to-r from-accent-secondary to-accent-secondary/80 text-background font-semibold">
                  {changePasswordMutation.isPending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> : <Save className="h-4 w-4" />}
                  {t("changePassword")}
                </Button>
                <Button type="button" onClick={() => { setShowChangePassword(false); setCurrentPassword(""); setNewPassword(""); setConfirmNewPassword(""); }} variant="ghost" className="gap-2 text-text-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                  {t("cancel")}
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <button onClick={() => navigate("/dashboard")} className="flex items-center gap-3 rounded-xl border border-border bg-primary p-5 text-start transition-all hover:border-accent-secondary hover:shadow-[0_8px_24px_rgba(6,182,212,0.08)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-secondary/10">
              <GraduationCap className="h-5 w-5 text-accent-secondary" />
            </div>
            <div>
              <p className="font-medium text-foreground">{t("myDashboard")}</p>
              <p className="text-xs text-text-muted">{lang === "en" ? "View your courses and progress" : "عرض كورساتك وتقدمك"}</p>
            </div>
          </button>
          <button onClick={() => navigate("/support")} className="flex items-center gap-3 rounded-xl border border-border bg-primary p-5 text-start transition-all hover:border-accent-secondary hover:shadow-[0_8px_24px_rgba(6,182,212,0.08)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-secondary/10">
              <Zap className="h-5 w-5 text-accent-secondary" />
            </div>
            <div>
              <p className="font-medium text-foreground">{t("support")}</p>
              <p className="text-xs text-text-muted">{lang === "en" ? "Get help with your account" : "احصل على مساعدة بخصوص حسابك"}</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function getNewPasswordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

function getNewPasswordStrengthLabel(password: string, lang: "en" | "ar"): string {
  const strength = getNewPasswordStrength(password);
  if (strength <= 1) return lang === "en" ? "Weak" : "ضعيفة";
  if (strength <= 2) return lang === "en" ? "Fair" : "مقبولة";
  if (strength <= 3) return lang === "en" ? "Good" : "جيدة";
  return lang === "en" ? "Strong" : "قوية";
}
