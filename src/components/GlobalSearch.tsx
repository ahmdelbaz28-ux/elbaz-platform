import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { Search, X, FileBox, HelpCircle, BookOpen } from "lucide-react";

export default function GlobalSearch() {
  const { lang } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = trpc.search.global.useQuery(
    { query, limit: 5 },
    { enabled: query.length >= 2, staleTime: 30000 }
  );

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const totalResults = useMemo(() => {
    if (!data) return 0;
    return data.total;
  }, [data]);

  const handleResultClick = (_type: string, link: string) => {
    navigate(link);
    setIsOpen(false);
    setQuery("");
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-[#1e2d3d] bg-[#0d1521] px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:border-cyan-500/30 transition-colors"
        title={lang === "ar" ? "بحث (Ctrl+K)" : "Search (Ctrl+K)"}
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{lang === "ar" ? "بحث..." : "Search..."}</span>
        <kbd className="hidden md:inline-block rounded border border-[#1e2d3d] px-1 text-[10px] text-slate-600">⌘K</kbd>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-[#0d1521] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-cyan-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === "ar" ? "ابحث في الكورسات، المراجع، الأسئلة..." : "Search courses, references, FAQ..."}
          className="flex-1 bg-transparent text-xs text-[#e8f0fe] placeholder:text-slate-500 focus:outline-none w-48 md:w-64"
        />
        {isFetching && <div className="h-3 w-3 animate-spin rounded-full border border-cyan-400 border-t-transparent" />}
        <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-slate-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Results dropdown */}
      {query.length >= 2 && data && (
        <div className="absolute top-full mt-2 w-full min-w-[400px] rounded-xl border border-[#1e2d3d] bg-[#0d1521] shadow-2xl shadow-black/50 max-h-[70vh] overflow-y-auto z-[100]">
          {totalResults === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              {lang === "ar" ? "لا توجد نتائج" : "No results found"}
            </div>
          ) : (
            <div className="p-2">
              {/* Courses */}
              {data.courses.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
                    {lang === "ar" ? "الكورسات" : "Courses"}
                  </p>
                  {data.courses.map((c: any) => (
                    <button
                      key={c.id}
                      onClick={() => handleResultClick("course", `/courses/${c.slug}`)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#111827] transition-colors"
                    >
                      <BookOpen className="h-4 w-4 flex-shrink-0 text-cyan-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#e8f0fe] truncate">{lang === "ar" ? c.titleAr : c.titleEn}</p>
                        <p className="text-xs text-slate-500">{c.level} • {c.isPremium ? `${c.price} EGP` : (lang === "ar" ? "مجاني" : "Free")}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* References */}
              {data.references.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
                    {lang === "ar" ? "المراجع" : "References"}
                  </p>
                  {data.references.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => handleResultClick("reference", `/references`)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#111827] transition-colors"
                    >
                      <FileBox className="h-4 w-4 flex-shrink-0 text-violet-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#e8f0fe] truncate">{r.title}</p>
                        <p className="text-xs text-slate-500 truncate">{r.fileName}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* FAQ */}
              {data.faqs.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
                    {lang === "ar" ? "الأسئلة الشائعة" : "FAQ"}
                  </p>
                  {data.faqs.map((f: any) => (
                    <button
                      key={f.id}
                      onClick={() => handleResultClick("faq", `/faq`)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#111827] transition-colors"
                    >
                      <HelpCircle className="h-4 w-4 flex-shrink-0 text-yellow-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#e8f0fe] truncate">{lang === "ar" ? f.questionAr : f.questionEn}</p>
                        <p className="text-xs text-slate-500 truncate">{lang === "ar" ? f.answerAr : f.answerEn}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="border-t border-[#1e2d3d] pt-2 px-3 py-1.5 text-[10px] text-slate-600">
                {totalResults} {lang === "ar" ? "نتيجة" : "results"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
