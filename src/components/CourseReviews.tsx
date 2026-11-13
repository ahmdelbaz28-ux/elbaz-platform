/**
 * COURSE REVIEWS — student ratings & comments section (CourseDetail).
 *
 * ✅ FEATURE GAP FIX (pre-launch audit): the backend shipped a complete
 * review system (review.listByCourse / myReview / create upsert / delete,
 * entitlement-gated) but NO page rendered it — reviewCount on course cards
 * could never grow and students had no social proof, the #1 conversion
 * lever on competitor platforms (Udemy, Coursera, Thinkific).
 *
 * Behaviour:
 *  - Public list (paginated) of published reviews for the course.
 *  - Authenticated users get a star-picker + comment form; submitting
 *    creates OR updates their single review (server-side upsert).
 *  - Unauthenticated users get a sign-in CTA with ?redirect= back here.
 *  - Server enforces entitlement (premium: active enrollment) — the client
 *    only surfaces a friendly message on FORBIDDEN.
 */
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Star, MessageSquareText, Lock } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";

interface ReviewItem {
  id: number;
  userId: number;
  courseId: number;
  rating: number;
  comment: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  userName: string | null;
  userUsername: string | null;
}

interface MyReview {
  id: number;
  rating: number;
  comment: string | null;
}

const PAGE_SIZE = 5;

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          aria-hidden="true"
          className={`${size} ${s <= value ? "fill-[#f59e0b] text-[#f59e0b]" : "text-[#475569]"}`}
        />
      ))}
    </div>
  );
}

export default function CourseReviews({ courseId, averageRating }: { readonly courseId: number; readonly averageRating: number }) {
  const { lang } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [listPage, setListPage] = useState(1);
  const [hoverRating, setHoverRating] = useState(0);
  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Types flow from the typed AppRouter — no explicit generics needed.
  const listQuery = trpc.review.listByCourse.useQuery({ courseId, page: listPage, limit: PAGE_SIZE });
  const myReviewQuery = trpc.review.myReview.useQuery({ courseId }, { enabled: isAuthenticated });

  const utils = trpc.useUtils();
  const submitMutation = trpc.review.create.useMutation({
    onSuccess: (result) => {
      toast.success(
        lang === "ar"
          ? result.action === "updated" ? "تم تحديث تقييمك، شكراً لك!" : "تم إضافة تقييمك، شكراً لك!"
          : result.action === "updated" ? "Your review was updated — thank you!" : "Your review was submitted — thank you!"
      );
      utils.review.listByCourse.invalidate({ courseId });
      utils.review.myReview.invalidate({ courseId });
      setShowForm(false);
    },
    onError: (err) => {
      const code = (err.data as { code?: string } | undefined)?.code;
      if (code === "FORBIDDEN") {
        toast.error(lang === "ar" ? "يجب التسجيل في الكورس أولاً قبل إضافة التقييم" : "Enroll in the course before leaving a review");
      } else {
        toast.error(lang === "ar" ? "تعذر إرسال التقييم، حاول مرة أخرى" : "Could not submit your review, please try again");
      }
    },
  });

  // Prefill the form from the user's existing review.
  const myReview: MyReview | null = myReviewQuery.data
    ? { id: myReviewQuery.data.id, rating: myReviewQuery.data.rating, comment: myReviewQuery.data.comment }
    : null;
  const openForm = () => {
    setDraftRating(myReviewQuery.data?.rating ?? 0);
    setDraftComment(myReviewQuery.data?.comment ?? "");
    setShowForm(true);
  };

  const items = (listQuery.data?.items ?? []) as ReviewItem[];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-label={lang === "ar" ? "تقييمات الطلاب" : "Student reviews"} className="mx-auto mt-10 max-w-7xl px-4 lg:px-6">
      <div className="rounded-xl border border-[#1f2d44] bg-[rgba(15,23,42,0.55)] p-6">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#f0f4f8]">
              <MessageSquareText className="h-5 w-5 text-[#06b6d4]" />
              {lang === "ar" ? "تقييمات الطلاب" : "Student Reviews"}
            </h2>
            <div className="mt-2 flex items-center gap-2">
              <Stars value={Math.round(averageRating)} />
              <span className="text-sm text-[#94a3b8]">
                {total > 0
                  ? (lang === "ar"
                      ? `${averageRating.toFixed(1)} من 5 (${total} تقييم)`
                      : `${averageRating.toFixed(1)} out of 5 (${total} review${total === 1 ? "" : "s"})`)
                  : (lang === "ar" ? "لا تقييمات بعد" : "No reviews yet")}
              </span>
            </div>
          </div>

          {isAuthenticated && !showForm && (
            <button
              onClick={openForm}
              data-testid="write-review-btn"
              className="rounded-lg bg-[#06b6d4] px-4 py-2 text-sm font-semibold text-[#0a0e17] transition-colors hover:bg-[#0891b2]"
            >
              {myReview
                ? (lang === "ar" ? "تعديل تقييمك" : "Edit your review")
                : (lang === "ar" ? "اكتب تقييماً" : "Write a review")}
            </button>
          )}
          {!isAuthenticated && (
            <Link
              to={`/login?redirect=/courses/${courseId}`}
              className="rounded-lg border border-[#1f2d44] px-4 py-2 text-sm text-[#94a3b8] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4]"
            >
              {lang === "ar" ? "سجّل الدخول لتقييم الكورس" : "Sign in to review"}
            </Link>
          )}
        </div>

        {/* ── Write / edit form ── */}
        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draftRating < 1) return;
              submitMutation.mutate({ courseId, rating: draftRating, comment: draftComment.trim() || undefined });
            }}
            className="mt-5 rounded-lg border border-[#1f2d44] bg-[rgba(10,14,23,0.6)] p-4"
          >
            <span className="text-sm font-medium text-[#f0f4f8]">
              {lang === "ar" ? "تقييمك" : "Your rating"}
            </span>
            <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label={lang === "ar" ? "اختر عدد النجوم" : "Choose a star rating"}>
              {[1, 2, 3, 4, 5].map((s) => (
                <label
                  key={s}
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="cursor-pointer rounded p-0.5 focus-within:outline-none focus-within:ring-2 focus-within:ring-[#06b6d4]"
                >
                  <input
                    type="radio"
                    name="course-review-rating"
                    value={s}
                    checked={draftRating === s}
                    onChange={() => setDraftRating(s)}
                    aria-label={`${s} ${lang === "ar" ? "نجوم" : "stars"}`}
                    className="sr-only"
                  />
                  <Star
                    aria-hidden="true"
                    className={`h-6 w-6 transition-colors ${
                      s <= (hoverRating || draftRating)
                        ? "fill-[#f59e0b] text-[#f59e0b]"
                        : "text-[#475569] hover:text-[#f59e0b]/60"
                    }`}
                  />
                </label>
              ))}
            </div>
            <textarea
              value={draftComment}
              onChange={(e) => setDraftComment(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={lang === "ar" ? "شاركنا تجربتك مع الكورس (اختياري)" : "Share your experience with this course (optional)"}
              className="mt-3 w-full rounded-lg border border-[#1f2d44] bg-[#0a0e17] p-3 text-sm text-[#f0f4f8] placeholder:text-[#475569] focus:border-[#06b6d4] focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="submit"
                disabled={draftRating < 1 || submitMutation.isPending}
                className="rounded-lg bg-[#06b6d4] px-4 py-2 text-sm font-semibold text-[#0a0e17] transition-colors hover:bg-[#0891b2] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitMutation.isPending
                  ? (lang === "ar" ? "جارٍ الإرسال…" : "Submitting…")
                  : myReview
                    ? (lang === "ar" ? "حفظ التعديل" : "Save changes")
                    : (lang === "ar" ? "إرسال التقييم" : "Submit review")}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-[#1f2d44] px-4 py-2 text-sm text-[#94a3b8] transition-colors hover:text-[#f0f4f8]"
              >
                {lang === "ar" ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </form>
        )}

        {/* ── Reviews list ── */}
        {items.length > 0 ? (
          <ul className="mt-6 space-y-4">
            {items.map((r) => (
              <li key={r.id} className="rounded-lg border border-[#1f2d44] bg-[rgba(10,14,23,0.5)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#06b6d4]/15 text-sm font-bold text-[#06b6d4]">
                      {(r.userName || r.userUsername || "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#f0f4f8]">{r.userName || r.userUsername || (lang === "ar" ? "طالب" : "Student")}</p>
                      <Stars value={r.rating} size="h-3.5 w-3.5" />
                    </div>
                  </div>
                  <time className="shrink-0 text-xs text-[#64748b]">
                    {new Date(r.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "short", day: "numeric" })}
                  </time>
                </div>
                {r.comment && (
                  <p className="mt-3 text-sm leading-relaxed text-[#94a3b8]">{r.comment}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-[#1f2d44] p-8 text-center">
            <p className="text-sm text-[#94a3b8]">
              {lang === "ar" ? "لا توجد تقييمات منشورة بعد — كن أول من يشارك تجربته!" : "No published reviews yet — be the first to share your experience!"}
            </p>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
              disabled={listPage <= 1}
              className="rounded-lg border border-[#1f2d44] px-3 py-1.5 text-sm text-[#94a3b8] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lang === "ar" ? "السابق" : "Prev"}
            </button>
            <span className="text-xs text-[#64748b]">
              {lang === "ar" ? `صفحة ${listPage} من ${totalPages}` : `Page ${listPage} of ${totalPages}`}
            </span>
            <button
              onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
              disabled={listPage >= totalPages}
              className="rounded-lg border border-[#1f2d44] px-3 py-1.5 text-sm text-[#94a3b8] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lang === "ar" ? "التالي" : "Next"}
            </button>
          </div>
        )}

        {/* Entitlement hint for premium non-enrolled users */}
        {!isAuthenticated && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-[#64748b]">
            <Lock className="h-3 w-3" />
            {lang === "ar" ? "التقييم متاح للطلاب المسجلين في الكورس" : "Reviews are for enrolled students"}
          </p>
        )}
      </div>
    </section>
  );
}
