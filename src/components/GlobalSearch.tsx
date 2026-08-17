import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { Search, X, FileBox, HelpCircle, BookOpen } from "lucide-react";

// ─── Helpers extracted to keep GlobalSearch below cognitive-complexity cap (S3776) ───
function formatCoursePrice(course: { isPremium?: boolean; price?: number | string }, lang: "ar" | "en"): string {
  if (course.isPremium) return `${course.price} EGP`;
  return lang === "ar" ? "مجاني" : "Free";
}

interface CourseHit { id: string | number; slug: string; titleAr?: string; titleEn?: string; level?: string; isPremium?: boolean; price?: number | string }
interface ReferenceHit { id: string | number; title: string; fileName: string }
interface FaqHit { id: string | number; questionAr?: string; questionEn?: string; answerAr?: string; answerEn?: string }

function CourseResults({ courses, lang, onPick }: {
  readonly courses: CourseHit[];
  readonly lang: "ar" | "en";
  readonly onPick: (link: string) => void;
}) {
  if (courses.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
        {lang === "ar" ? "الكورسات" : "Courses"}
      </p>
      {courses.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(`/courses/${c.slug}`)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#111827] transition-colors"
        >
          <BookOpen className="h-4 w-4 flex-shrink-0 text-cyan-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#e8f0fe] truncate">{lang === "ar" ? c.titleAr : c.titleEn}</p>
            <p className="text-xs text-slate-500">{c.level} • {formatCoursePrice(c, lang)}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function ReferenceResults({ references, lang, onPick }: {
  readonly references: ReferenceHit[];
  readonly lang: "ar" | "en";
  readonly onPick: (link: string) => void;
}) {
  if (references.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
        {lang === "ar" ? "المراجع" : "References"}
      </p>
      {references.map((r) => (
        <button
          key={r.id}
          onClick={() => onPick(`/references`)}
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
  );
}

function FaqResults({ faqs, lang, onPick }: {
  readonly faqs: FaqHit[];
  readonly lang: "ar" | "en";
  readonly onPick: (link: string) => void;
}) {
  if (faqs.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600">
        {lang === "ar" ? "الأسئلة الشائعة" : "FAQ"}
      </p>
      {faqs.map((f) => (
        <button
          key={f.id}
          onClick={() => onPick(`/faq`)}
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
  );
}

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
      setQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
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

  const totalResults = useMemo(() => (data ? data.total : 0), [data]);

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

  const showDropdown = query.length >= 2 && Boolean(data);

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
      {showDropdown && (
        <div className="absolute top-full mt-2 w-full min-w-[400px] rounded-xl border border-[#1e2d3d] bg-[#0d1521] shadow-2xl shadow-black/50 max-h-[70vh] overflow-y-auto z-[100]">
          {totalResults === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              {lang === "ar" ? "لا توجد نتائج" : "No results found"}
            </div>
          ) : (
            <div className="p-2">
              <CourseResults courses={data!.courses as CourseHit[]} lang={lang} onPick={(link) => handleResultClick("course", link)} />
              <ReferenceResults references={data!.references as ReferenceHit[]} lang={lang} onPick={(link) => handleResultClick("reference", link)} />
              <FaqResults faqs={data!.faqs as FaqHit[]} lang={lang} onPick={(link) => handleResultClick("faq", link)} />

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
