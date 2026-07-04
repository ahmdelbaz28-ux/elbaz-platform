import { useState, useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, HelpCircle, MessageCircle } from "lucide-react";
import { Link } from "react-router";

interface FaqItem {
  id: number;
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
  category: string;
  sortOrder: number;
  isPublished: boolean;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORY_LABELS: Record<string, { en: string; ar: string }> = {
  general: { en: "General", ar: "عام" },
  courses: { en: "Courses", ar: "الكورسات" },
  payments: { en: "Payments", ar: "المدفوعات" },
  certificates: { en: "Certificates", ar: "الشهادات" },
  technical: { en: "Technical", ar: "تقني" },
  account: { en: "Account", ar: "الحساب" },
};

export default function Faq() {
  const { lang } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading } = trpc.faq.list.useQuery({});
  const { data: categories } = trpc.faq.categories.useQuery();
  const incrementView = trpc.faq.incrementView.useMutation();

  const items = useMemo(() => {
    if (!data?.items) return [];
    return data.items as FaqItem[];
  }, [data]);

  const filtered = useMemo(() => {
    let result = items;
    if (selectedCategory !== "all") {
      result = result.filter((i) => i.category === selectedCategory);
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((i) =>
        i.questionEn.toLowerCase().includes(term) ||
        i.questionAr.toLowerCase().includes(term) ||
        i.answerEn.toLowerCase().includes(term) ||
        i.answerAr.toLowerCase().includes(term)
      );
    }
    return result;
  }, [items, search, selectedCategory]);

  const toggleOpen = (id: number) => {
    if (openId !== id) {
      incrementView.mutate({ id });
    }
    setOpenId(openId === id ? null : id);
  };

  return (
    <>
      <Seo
        title={lang === "ar" ? "الأسئلة الشائعة | منصة الباز" : "FAQ | Elbaz Platform"}
        description={lang === "ar" ? "إجابات على أكثر الأسئلة شيوعاً حول الكورسات والمدفوعات والشهادات" : "Answers to the most common questions about courses, payments, and certificates"}
      />
      <div className="min-h-screen bg-[#0a0e17] text-[#e8f0fe]">
        <div className="relative overflow-hidden border-b border-[#1e2d3d] bg-gradient-to-br from-cyan-600/10 to-blue-600/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.15),transparent_60%)]" />
          <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 text-center">
            <div className="mb-4 flex h-14 w-14 mx-auto items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25">
              <HelpCircle className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white md:text-4xl mb-3">
              {lang === "ar" ? "الأسئلة الشائعة" : "Frequently Asked Questions"}
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl mx-auto">
              {lang === "ar" ? "إجابات على أكثر الأسئلة شيوعاً. لم تجد إجابتك؟ تواصل مع الدعم." : "Answers to the most common questions. Didn't find your answer? Contact support."}
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === "ar" ? "ابحث في الأسئلة..." : "Search questions..."}
                className="pl-10 bg-[#0d1521] border-[#1e2d3d] text-[#e8f0fe] placeholder:text-slate-500"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedCategory === "all"
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-[#0d1521] text-slate-400 border border-[#1e2d3d] hover:text-slate-200"
                }`}
              >
                {lang === "ar" ? "الكل" : "All"}
              </button>
              {(categories || []).map((cat: string) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-[#0d1521] text-slate-400 border border-[#1e2d3d] hover:text-slate-200"
                  }`}
                >
                  {CATEGORY_LABELS[cat]?.[lang] || cat}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-[#0d1521] border border-[#1e2d3d] animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <HelpCircle className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 mb-4">
                {lang === "ar" ? "لا توجد نتائج لبحثك" : "No results found"}
              </p>
              <Link
                to="/support"
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20"
              >
                <MessageCircle className="h-4 w-4" />
                {lang === "ar" ? "تواصل مع الدعم" : "Contact Support"}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] overflow-hidden"
                >
                  <button
                    onClick={() => toggleOpen(item.id)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#111827] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-400">
                        {CATEGORY_LABELS[item.category]?.[lang] || item.category}
                      </span>
                      <span className="text-sm font-medium text-[#e8f0fe]">
                        {lang === "ar" ? item.questionAr : item.questionEn}
                      </span>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${
                        openId === item.id ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {openId === item.id && (
                    <div className="px-5 pb-4 text-sm text-slate-400 leading-relaxed border-t border-[#1e2d3d]/50 pt-3">
                      {lang === "ar" ? item.answerAr : item.answerEn}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 text-center">
            <p className="text-sm text-slate-500 mb-3">
              {lang === "ar" ? "لم تجد إجابة لسؤالك؟" : "Didn't find an answer?"}
            </p>
            <Link
              to="/support"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:shadow-lg hover:shadow-cyan-500/25"
            >
              <MessageCircle className="h-4 w-4" />
              {lang === "ar" ? "تواصل مع الدعم" : "Contact Support"}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
