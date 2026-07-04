import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Heart, Trash2, BookOpen, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

export default function Wishlist() {
  const { lang } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { data, isLoading, refetch } = trpc.wishlist.list.useQuery();
  const removeMutation = trpc.wishlist.remove.useMutation();

  const handleRemove = async (courseId: number) => {
    try {
      await removeMutation.mutateAsync({ courseId });
      toast.success(lang === "ar" ? "تمت الإزالة من المفضلة" : "Removed from wishlist");
      refetch();
    } catch {
      toast.error(lang === "ar" ? "فشل الإزالة" : "Failed to remove");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] text-[#e8f0fe]">
        <div className="text-center">
          <Heart className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 mb-4">{lang === "ar" ? "سجل دخولك لعرض المفضلة" : "Log in to view your wishlist"}</p>
          <Link to="/login" className="text-cyan-400 hover:underline">{lang === "ar" ? "تسجيل الدخول" : "Login"}</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Seo title={lang === "ar" ? "المفضلة | منصة الباز" : "Wishlist | Elbaz Platform"} description={lang === "ar" ? "الكورسات المحفوظة في قائمتك" : "Your saved courses"} />
      <div className="min-h-screen bg-[#0a0e17] text-[#e8f0fe]">
        <div className="border-b border-[#1e2d3d] bg-gradient-to-r from-rose-600/10 to-pink-600/10">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-pink-600">
                <Heart className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {lang === "ar" ? "قائمة المفضلة" : "My Wishlist"}
                </h1>
                <p className="text-xs text-slate-400">
                  {data?.items?.length || 0} {lang === "ar" ? "كورس محفوظ" : "saved courses"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            </div>
          ) : !data?.items || data.items.length === 0 ? (
            <div className="text-center py-20">
              <Heart className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-4">{lang === "ar" ? "قائمة المفضلة فارغة" : "Your wishlist is empty"}</p>
              <Link to="/courses" className="inline-flex items-center gap-2 text-cyan-400 hover:underline">
                <BookOpen className="h-4 w-4" />
                {lang === "ar" ? "تصفح الكورسات" : "Browse Courses"}
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((item: any) => (
                <div key={item.wishlist.id} className="group rounded-xl border border-[#1e2d3d] bg-[#0d1521] overflow-hidden hover:border-cyan-500/30 transition-colors">
                  {item.thumbnail && (
                    <div className="aspect-video overflow-hidden bg-[#0a0e17]">
                      <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-[#e8f0fe]">
                      {lang === "ar" ? item.titleAr : item.titleEn}
                    </h3>
                    <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                      <span className="rounded bg-[#1a2434] px-1.5 py-0.5">{item.level}</span>
                      {item.isPremium ? (
                        <span className="text-cyan-400">{item.price} EGP</span>
                      ) : (
                        <span className="text-green-400">{lang === "ar" ? "مجاني" : "Free"}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Link to={`/courses/${item.slug}`} className="flex-1">
                        <Button size="sm" className="w-full bg-gradient-to-r from-cyan-500 to-blue-600">
                          {lang === "ar" ? "عرض" : "View"}
                        </Button>
                      </Link>
                      <Button
                        onClick={() => handleRemove(item.courseId)}
                        size="sm"
                        variant="outline"
                        className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
