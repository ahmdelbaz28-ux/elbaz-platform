import { useState, useMemo, useCallback, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileArchive,
  FileCode,
  File,
  Download,
  Search,
  Loader2,
  X,
  FileBox,
  HardDriveDownload,
  BookMarked,
  Filter,
  ChevronDown,
  Clock,
} from "lucide-react";

/* ── Types ── */

interface ReferenceFile {
  id: number;
  title: string;
  description: string | null;
  fileName: string;
  fileKey: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  category: string | null;
  uploadedById: number | null;
  isPublic: boolean;
  isPublished: boolean;
  downloadCount: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/* ── Helpers ── */

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function getFileIcon(fileType: string): ReactNode {
  if (fileType.startsWith("image/")) return <FileImage className="h-5 w-5 text-cyan-400" />;
  if (fileType.includes("pdf")) return <FileText className="h-5 w-5 text-red-400" />;
  if (fileType.includes("excel") || fileType.includes("spreadsheet") || fileType.includes("csv"))
    return <FileSpreadsheet className="h-5 w-5 text-green-400" />;
  if (fileType.includes("word") || fileType.includes("document"))
    return <FileText className="h-5 w-5 text-blue-400" />;
  if (fileType.includes("powerpoint") || fileType.includes("presentation"))
    return <FileText className="h-5 w-5 text-orange-400" />;
  if (fileType.includes("zip") || fileType.includes("rar") || fileType.includes("7z") || fileType.includes("tar") || fileType.includes("gzip"))
    return <FileArchive className="h-5 w-5 text-yellow-400" />;
  if (fileType.includes("json") || fileType.includes("xml") || fileType.includes("javascript") || fileType.includes("text/"))
    return <FileCode className="h-5 w-5 text-purple-400" />;
  return <File className="h-5 w-5 text-slate-400" />;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toUpperCase() : "FILE";
}

/* ── Loading State ── */

function DocumentsLoading({ lang }: { readonly lang: "ar" | "en" }) {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <Loader2 className="h-10 w-10 animate-spin text-[#06b6d4]" />
      <p className="mt-4 text-sm text-[#94a3b8]">
        {lang === "ar" ? "جارٍ تحميل المستندات..." : "Loading documents..."}
      </p>
    </div>
  );
}

/* ── Empty State ── */

function DocumentsEmpty({ lang, hasFilter }: { readonly lang: "ar" | "en"; readonly hasFilter: boolean }) {
  const heading = hasFilter
    ? (lang === "ar" ? "لا توجد نتائج" : "No results found")
    : (lang === "ar" ? "لا توجد مستندات بعد" : "No documents yet");
  const subtext = hasFilter
    ? (lang === "ar" ? "جرب تغيير البحث أو الفئة" : "Try changing your search or category")
    : (lang === "ar" ? "سيتم إضافة المستندات قريباً" : "Documents will be added soon");

  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#111827] border border-[#1e2d3d]">
        <FileBox className="h-10 w-10 text-[#475569]" />
      </div>
      <h3 className="text-lg font-semibold text-[#e8f0fe]">{heading}</h3>
      <p className="mt-2 text-sm text-[#64748b]">{subtext}</p>
    </div>
  );
}

/* ── File Card ── */

interface FileCardProps {
  readonly item: ReferenceFile;
  readonly lang: "ar" | "en";
  readonly isDownloading: boolean;
  readonly onDownload: (id: number, fileName: string) => void;
}

function FileCard({ item, lang, isDownloading, onDownload }: FileCardProps) {
  const ext = getFileExtension(item.fileName);

  return (
    <div className="group relative flex flex-col rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-5 transition-all duration-200 hover:border-[rgba(6,182,212,0.35)] hover:bg-[#111827] hover:shadow-[0_8px_32px_rgba(6,182,212,0.06)]">
      {/* Header: Icon + Extension badge */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1a2434] group-hover:bg-[rgba(6,182,212,0.08)] transition-colors">
          {getFileIcon(item.fileType)}
        </div>
        <span className="rounded-md bg-[#1a2434] px-2 py-0.5 text-[10px] font-bold text-[#64748b]">
          {ext}
        </span>
      </div>

      {/* Title */}
      <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-[#e8f0fe] group-hover:text-[#06b6d4] transition-colors" title={item.title}>
        {item.title}
      </h3>

      {/* Description */}
      {item.description && (
        <p className="mb-3 line-clamp-2 text-xs text-[#64748b]" title={item.description}>
          {item.description}
        </p>
      )}

      {/* Meta row */}
      <div className="mt-auto space-y-2">
        <div className="flex items-center justify-between text-[11px] text-[#64748b]">
          <span className="truncate max-w-[140px]" title={item.fileName}>{item.fileName}</span>
          <span>{formatFileSize(item.fileSize)}</span>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-[11px] text-[#475569]">
          <span className="flex items-center gap-1">
            <HardDriveDownload className="h-3 w-3" />
            {item.downloadCount}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(item.createdAt)}
          </span>
        </div>

        {/* Category tag */}
        {item.category && item.category !== "general" && (
          <span className="inline-block rounded-full bg-[rgba(6,182,212,0.08)] px-2 py-0.5 text-[10px] font-medium text-[#06b6d4]">
            {item.category}
          </span>
        )}

        {/* Download button */}
        <Button
          onClick={() => onDownload(item.id, item.fileName)}
          disabled={isDownloading}
          size="sm"
          className="mt-2 w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] font-semibold hover:shadow-[0_4px_16px_rgba(6,182,212,0.25)] transition-all"
        >
          {isDownloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span className="mr-1.5">{lang === "ar" ? "تنزيل" : "Download"}</span>
        </Button>
      </div>
    </div>
  );
}

/* ── Main Component ── */

export default function Documents() {
  const { lang } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // ─── Queries ───
  const { data, isLoading } = trpc.references.list.useQuery({});
  const { data: categories } = trpc.references.categories.useQuery();

  // ─── Mutations ───
  const getDownloadUrl = trpc.references.getDownloadUrl.useMutation();

  // ─── Filtered items ───
  const items = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((item: ReferenceFile) => {
      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        (item.description || "").toLowerCase().includes(search.toLowerCase()) ||
        item.fileName.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [data, search, selectedCategory]);

  // ─── Stats ───
  const totalFiles = data?.items?.length || 0;
  const totalDownloads = useMemo(() => {
    return (data?.items || []).reduce((sum: number, item: ReferenceFile) => sum + item.downloadCount, 0);
  }, [data]);

  // ─── Download handler ───
  const handleDownload = useCallback(
    async (id: number, fileName: string) => {
      setDownloadingId(id);
      try {
        const result = await getDownloadUrl.mutateAsync({ id });
        const a = document.createElement("a");
        a.href = result.downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success(lang === "ar" ? "بدأ التنزيل" : "Download started");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Download failed";
        toast.error(errMsg);
      } finally {
        setDownloadingId(null);
      }
    },
    [getDownloadUrl, lang],
  );

  // ─── Render ───
  return (
    <>
      <Seo
        title={lang === "ar" ? "المستندات | منصة الباز" : "Documents | Elbaz Platform"}
        description={
          lang === "ar"
            ? "مكتبة المستندات الهندسية — كتب PDF، جداول Excel، ملفات AutoCAD، وعروض تقديمية للطلاب"
            : "Engineering documents library — PDF books, Excel sheets, AutoCAD files, and presentations for students"
        }
      />

      <div className="min-h-screen bg-[#0a0e17] pt-20">
        {/* ─── Hero Section ─── */}
        <div className="relative overflow-hidden border-b border-[#1e2d3d] bg-gradient-to-br from-[rgba(6,182,212,0.08)] to-[rgba(8,145,178,0.04)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.12),transparent_60%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#06b6d4] to-[#0891b2] shadow-lg shadow-[rgba(6,182,212,0.25)]">
                    <BookMarked className="h-7 w-7 text-white" />
                  </div>
                  <h1 className="text-3xl font-bold text-[#e8f0fe] md:text-4xl">
                    {lang === "ar" ? "المستندات الدراسية" : "Study Documents"}
                  </h1>
                </div>
                <p className="max-w-2xl text-sm text-[#94a3b8] md:text-base">
                  {lang === "ar"
                    ? "مكتبتك الشاملة من المستندات الهندسية — كتب PDF، جداول Excel، ملفات AutoCAD، وعروض تقديمية. كل ما تحتاجه لمساندتك في رحلتك التعليمية."
                    : "Your comprehensive library of engineering documents — PDF books, Excel spreadsheets, AutoCAD files, and presentations. Everything you need for your learning journey."}
                </p>
              </div>

              {/* Stats */}
              <div className="flex gap-3">
                <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] px-5 py-3 text-center">
                  <div className="text-2xl font-bold text-[#06b6d4]">{totalFiles}</div>
                  <div className="text-xs text-[#64748b]">{lang === "ar" ? "ملف" : "Files"}</div>
                </div>
                <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] px-5 py-3 text-center">
                  <div className="text-2xl font-bold text-[#10b981]">{totalDownloads}</div>
                  <div className="text-xs text-[#64748b]">{lang === "ar" ? "تنزيل" : "Downloads"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Search & Filter Bar ─── */}
        <div className="sticky top-16 z-20 border-b border-[#1e2d3d] bg-[#0a0e17]/95 backdrop-blur-md">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {/* Search */}
              <div className="relative flex-1 md:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={lang === "ar" ? "ابحث في المستندات..." : "Search documents..."}
                  className="pl-10 bg-[#0d1521] border-[#1e2d3d] text-[#e8f0fe] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#e8f0fe] transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Mobile filter toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 rounded-lg border border-[#1e2d3d] bg-[#0d1521] px-3 py-2 text-sm text-[#94a3b8] hover:text-[#e8f0fe] md:hidden"
              >
                <Filter className="h-4 w-4" />
                {lang === "ar" ? "تصفية" : "Filter"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>

              {/* Desktop category filter */}
              <div className="hidden md:flex md:items-center md:gap-2">
                <span className="text-xs text-[#64748b]">{lang === "ar" ? "الفئة:" : "Category:"}</span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="rounded-lg border border-[#1e2d3d] bg-[#0d1521] px-3 py-2 text-sm text-[#e8f0fe] focus:border-[#06b6d4] focus:outline-none focus:ring-1 focus:ring-[#06b6d4]"
                >
                  <option value="all">{lang === "ar" ? "كل الفئات" : "All categories"}</option>
                  {(categories || []).map((cat: string) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mobile category filter (collapsible) */}
            {showFilters && (
              <div className="mt-3 md:hidden">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedCategory("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedCategory === "all"
                        ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4] border border-[rgba(6,182,212,0.3)]"
                        : "bg-[#0d1521] text-[#64748b] border border-[#1e2d3d] hover:text-[#e8f0fe]"
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
                          ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4] border border-[rgba(6,182,212,0.3)]"
                          : "bg-[#0d1521] text-[#64748b] border border-[#1e2d3d] hover:text-[#e8f0fe]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Files Grid ─── */}
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {isLoading ? (
            <DocumentsLoading lang={lang} />
          ) : items.length === 0 ? (
            <DocumentsEmpty lang={lang} hasFilter={Boolean(search) || selectedCategory !== "all"} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item: ReferenceFile) => (
                <FileCard
                  key={item.id}
                  item={item}
                  lang={lang}
                  isDownloading={downloadingId === item.id}
                  onDownload={handleDownload}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
