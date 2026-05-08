import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Profile() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  // ─── Profile Edit State ──────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // ─── Change Password State ───────────────────────────────────
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // ─── Mutations ───────────────────────────────────────────────
  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      toast.success(lang === "en" ? "Profile updated successfully" : "تم تحديث الملف الشخصي بنجاح");
      setIsEditing(false);
      // Refresh user data
      window.location.reload();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success(lang === "en" ? "Password changed successfully. Please login again." : "تم تغيير كلمة المرور بنجاح. يرجى تسجيل الدخول مرة أخرى.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowChangePassword(false);
      // Force re-login since tokenVersion is incremented
      setTimeout(() => {
        logout();
      }, 2000);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // ─── Fetch enrollments & certificates for stats ──────────────
  const { data: myEnrollments } = trpc.course.enrollments.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: myCertificates } = trpc.certificate.myCertificates.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // ─── Handlers ────────────────────────────────────────────────
  const handleStartEdit = () => {
    setEditName(user?.name || "");
    setEditEmail(user?.email || "");
    setIsEditing(true);
  };

  const handleSaveProfile = () => {
    if (!editName.trim()) {
      toast.error(lang === "en" ? "Name is required" : "الاسم مطلوب");
      return;
    }
    if (editEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail)) {
      toast.error(lang === "en" ? "Invalid email format" : "صيغة البريد الإلكتروني غير صحيحة");
      return;
    }
    updateProfileMutation.mutate({
      name: editName.trim(),
      email: editEmail.trim() || undefined,
    });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error(lang === "en" ? "Please fill in all fields" : "يرجى ملء جميع الحقول");
      return;
    }
    if (newPassword.length < 8) {
      toast.error(lang === "en" ? "New password must be at least 8 characters" : "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error(lang === "en" ? "Passwords do not match" : "كلمات المرور غير متطابقة");
      return;
    }
    if (currentPassword === newPassword) {
      toast.error(lang === "en" ? "New password must be different from current password" : "كلمة المرور الجديدة يجب أن تختلف عن الحالية");
      return;
    }
    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  // ─── Loading ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { year: "numeric", month: "long" })
    : "—";

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-4xl px-4 pb-20 lg:px-6">
        {/* ─── Page Header ────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#f0f4f8]">
            {t("myProfile")}
          </h1>
          <p className="mt-1 text-sm text-[#94a3b8]">
            {lang === "en" ? "Manage your account settings and preferences" : "إدارة إعدادات حسابك وتفضيلاتك"}
          </p>
        </div>

        {/* ─── Profile Card ───────────────────────────────────── */}
        <div className="mb-6 rounded-xl border border-[#1f2d44] bg-[#111827] p-8">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            {/* Avatar */}
            <div className="relative">
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-[#06b6d4] to-[#0284c7] text-4xl font-bold text-white shadow-[0_0_32px_rgba(6,182,212,0.3)]">
                {(user.name || user.username || "U").charAt(0).toUpperCase()}
              </div>
              {user.role === "admin" && (
                <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#111827] bg-[#f59e0b]">
                  <Shield className="h-3.5 w-3.5 text-[#0a0e17]" />
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 text-center sm:text-start">
              <h2 className="text-2xl font-bold text-[#f0f4f8]">
                {user.name || user.username}
              </h2>
              <p className="mt-1 text-sm text-[#06b6d4]">
                @{user.username}
              </p>
              {user.email && (
                <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-[#94a3b8] sm:justify-start">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="flex items-center gap-1 rounded-full bg-[rgba(6,182,212,0.1)] px-3 py-1 text-xs font-medium text-[#06b6d4]">
                  <User className="h-3 w-3" />
                  {user.role === "admin"
                    ? (lang === "en" ? "Administrator" : "مدير")
                    : (lang === "en" ? "Student" : "طالب")}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-[rgba(16,185,129,0.1)] px-3 py-1 text-xs font-medium text-[#10b981]">
                  <Calendar className="h-3 w-3" />
                  {lang === "en" ? "Joined" : "انضم"} {memberSince}
                </span>
              </div>
            </div>

            {/* Edit Button */}
            {!isEditing && (
              <Button
                onClick={handleStartEdit}
                className="gap-2 border border-[#1f2d44] bg-transparent text-[#94a3b8] hover:border-[#06b6d4] hover:text-[#06b6d4]"
              >
                <Edit3 className="h-4 w-4" />
                {t("editProfile")}
              </Button>
            )}
          </div>
        </div>

        {/* ─── Edit Profile Form (shown when editing) ─────────── */}
        {isEditing && (
          <div className="mb-6 rounded-xl border border-[rgba(6,182,212,0.3)] bg-[#111827] p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[#f0f4f8]">
              <Edit3 className="h-5 w-5 text-[#06b6d4]" />
              {t("editProfile")}
            </h3>
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("name")}</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={t("enterName")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("email")}</Label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder={t("enterEmail")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleSaveProfile}
                  disabled={updateProfileMutation.isPending}
                  className="gap-2 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] font-semibold"
                >
                  {updateProfileMutation.isPending ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("save")}
                </Button>
                <Button
                  onClick={() => setIsEditing(false)}
                  variant="ghost"
                  className="gap-2 text-[#94a3b8] hover:text-[#f0f4f8]"
                >
                  <X className="h-4 w-4" />
                  {t("cancel")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Stats Grid ─────────────────────────────────────── */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
              <GraduationCap className="h-5 w-5 text-[#06b6d4]" />
            </div>
            <p className="text-2xl font-bold text-[#f0f4f8]">{myEnrollments?.length || 0}</p>
            <p className="mt-1 text-xs text-[#64748b]">{lang === "en" ? "Enrolled Courses" : "كورسات مسجل بها"}</p>
          </div>
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(16,185,129,0.1)]">
              <Award className="h-5 w-5 text-[#10b981]" />
            </div>
            <p className="text-2xl font-bold text-[#f0f4f8]">{myCertificates?.length || 0}</p>
            <p className="mt-1 text-xs text-[#64748b]">{t("myCertificates")}</p>
          </div>
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.1)]">
              <Zap className="h-5 w-5 text-[#f59e0b]" />
            </div>
            <p className="text-2xl font-bold text-[#f0f4f8]">
              {user.role === "admin" ? "Admin" : "Student"}
            </p>
            <p className="mt-1 text-xs text-[#64748b]">{lang === "en" ? "Account Level" : "مستوى الحساب"}</p>
          </div>
        </div>

        {/* ─── Security Section ───────────────────────────────── */}
        <div className="mb-6 rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[#f0f4f8]">
              <Lock className="h-5 w-5 text-[#06b6d4]" />
              {t("securitySettings")}
            </h3>
            {!showChangePassword && (
              <Button
                onClick={() => setShowChangePassword(true)}
                variant="outline"
                size="sm"
                className="gap-2 border-[#1f2d44] text-[#94a3b8] hover:border-[#06b6d4] hover:text-[#06b6d4]"
              >
                <Lock className="h-3.5 w-3.5" />
                {t("changePassword")}
              </Button>
            )}
          </div>

          {/* Security info when not changing password */}
          {!showChangePassword && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-[#0a0e17] p-4">
                <CheckCircle2 className="h-5 w-5 text-[#10b981]" />
                <div>
                  <p className="text-sm font-medium text-[#f0f4f8]">
                    {lang === "en" ? "Password Protection" : "حماية كلمة المرور"}
                  </p>
                  <p className="text-xs text-[#64748b]">
                    {lang === "en"
                      ? "Your account is secured with an encrypted password (bcrypt)"
                      : "حسابك محمي بكلمة مرور مشفرة (bcrypt)"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-[#0a0e17] p-4">
                <CheckCircle2 className="h-5 w-5 text-[#10b981]" />
                <div>
                  <p className="text-sm font-medium text-[#f0f4f8]">
                    {lang === "en" ? "JWT Authentication" : "مصادقة JWT"}
                  </p>
                  <p className="text-xs text-[#64748b]">
                    {lang === "en"
                      ? "Secure token-based authentication with automatic expiration"
                      : "مصادقة آمنة بالرمز مع انتهاء صلاحية تلقائي"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Change password form */}
          {showChangePassword && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <Label className="text-sm text-[#94a3b8]">
                  {lang === "en" ? "Current Password" : "كلمة المرور الحالية"}
                </Label>
                <div className="relative mt-1">
                  <Input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={lang === "en" ? "Enter current password" : "أدخل كلمة المرور الحالية"}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">
                  {lang === "en" ? "New Password" : "كلمة المرور الجديدة"}
                </Label>
                <div className="relative mt-1">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={lang === "en" ? "Enter new password (min 8 chars)" : "أدخل كلمة المرور الجديدة (8 أحرف على الأقل)"}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* Password strength indicator */}
                {newPassword.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((level) => {
                        const strength = getNewPasswordStrength(newPassword);
                        const isActive = level <= strength;
                        return (
                          <div
                            key={level}
                            className={`h-1 flex-1 rounded-full transition-all ${
                              isActive
                                ? strength <= 1
                                  ? "bg-[#ef4444]"
                                  : strength <= 2
                                  ? "bg-[#f59e0b]"
                                  : strength <= 3
                                  ? "bg-[#06b6d4]"
                                  : "bg-[#10b981]"
                                : "bg-[#1f2d44]"
                            }`}
                          />
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-[#64748b]">
                      {getNewPasswordStrengthLabel(newPassword, lang)}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">
                  {lang === "en" ? "Confirm New Password" : "تأكيد كلمة المرور الجديدة"}
                </Label>
                <Input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder={lang === "en" ? "Confirm new password" : "أكد كلمة المرور الجديدة"}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
                {confirmNewPassword && newPassword !== confirmNewPassword && (
                  <p className="mt-1 text-xs text-[#f43f5e]">
                    {lang === "en" ? "Passwords do not match" : "كلمات المرور غير متطابقة"}
                  </p>
                )}
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 rounded-lg bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)] p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f59e0b]" />
                <p className="text-xs text-[#f59e0b]">
                  {lang === "en"
                    ? "After changing your password, you will be logged out and need to sign in again."
                    : "بعد تغيير كلمة المرور، سيتم تسجيل خروجك وستحتاج لتسجيل الدخول مرة أخرى."}
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={changePasswordMutation.isPending}
                  className="gap-2 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] font-semibold"
                >
                  {changePasswordMutation.isPending ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("changePassword")}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setShowChangePassword(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmNewPassword("");
                  }}
                  variant="ghost"
                  className="gap-2 text-[#94a3b8] hover:text-[#f0f4f8]"
                >
                  <X className="h-4 w-4" />
                  {t("cancel")}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* ─── Quick Actions ──────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] p-5 text-start transition-all hover:border-[#06b6d4] hover:shadow-[0_8px_24px_rgba(6,182,212,0.06)]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
              <GraduationCap className="h-5 w-5 text-[#06b6d4]" />
            </div>
            <div>
              <p className="font-medium text-[#f0f4f8]">{t("myDashboard")}</p>
              <p className="text-xs text-[#64748b]">
                {lang === "en" ? "View your courses and progress" : "عرض كورساتك وتقدمك"}
              </p>
            </div>
          </button>
          <button
            onClick={() => navigate("/support")}
            className="flex items-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] p-5 text-start transition-all hover:border-[#06b6d4] hover:shadow-[0_8px_24px_rgba(6,182,212,0.06)]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
              <Zap className="h-5 w-5 text-[#06b6d4]" />
            </div>
            <div>
              <p className="font-medium text-[#f0f4f8]">{t("support")}</p>
              <p className="text-xs text-[#64748b]">
                {lang === "en" ? "Get help with your account" : "احصل على مساعدة بخصوص حسابك"}
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Password Strength Helpers ─────────────────────────────────
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
