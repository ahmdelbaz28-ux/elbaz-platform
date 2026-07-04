import { useState, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
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
  Upload,
  Search,
  Trash2,
  Loader2,
  X,
  FileBox,
  HardDriveDownload,
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
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getFileIcon(fileType: string): React.ReactNode {
  if (fileType.startsWith("image/")) return <FileImage className="h-6 w-6 text-cyan-400" />;
  if (fileType.includes("pdf")) return <FileText className="h-6 w-6 text-red-400" />;
  if (fileType.includes("excel") || fileType.includes("spreadsheet") || fileType.includes("csv")) return <FileSpreadsheet className="h-6 w-6 text-green-400" />;
  if (fileType.includes("word") || fileType.includes("document")) return <FileText className="h-6 w-6 text-blue-400" />;
  if (fileType.includes("powerpoint") || fileType.includes("presentation")) return <FileText className="h-6 w-6 text-orange-400" />;
  if (fileType.includes("zip") || fileType.includes("rar") || fileType.includes("7z") || fileType.includes("tar") || fileType.includes("gzip")) return <FileArchive className="h-6 w-6 text-yellow-400" />;
  if (fileType.includes("json") || fileType.includes("xml") || fileType.includes("javascript") || fileType.includes("text/")) return <FileCode className="h-6 w-6 text-purple-400" />;
  return <File className="h-6 w-6 text-slate-400" />;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toUpperCase() : "FILE";
}

/* ── Component ── */

export default function References() {
  const { lang } = useTranslation();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // ─── Queries ───
  const [listQuery] = useState({ category: undefined, search: undefined });
  const { data, isLoading, refetch } = trpc.references.list.useQuery(listQuery);
  const { data: categories } = trpc.references.categories.useQuery();

  // ─── Mutations ───
  const getUploadUrl = trpc.references.getUploadUrl.useMutation();
  const createReference = trpc.references.create.useMutation();
  const getDownloadUrl = trpc.references.getDownloadUrl.useMutation();
  const deleteReference = trpc.references.delete.useMutation();

  // ─── Filtered items ───
  const items = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((item: ReferenceFile) => {
      const matchesSearch = !search ||
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        (item.description || "").toLowerCase().includes(search.toLowerCase()) ||
        item.fileName.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [data, search, selectedCategory]);

  // ─── Download handler ───
  const handleDownload = useCallback(async (id: number, fileName: string) => {
    setDownloadingId(id);
    try {
      const result = await getDownloadUrl.mutateAsync({ id });
      // Create a temporary <a> element to trigger the download
      const a = document.createElement("a");
      a.href = result.downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(lang === "ar" ? "بدأ التنزيل" : "Download started");
    } catch (err) {
      console.error("[References] Download failed:", err);
      const errMsg = err instanceof Error ? err.message : "Download failed";
      toast.error(errMsg);
    } finally {
      setDownloadingId(null);
    }
  }, [getDownloadUrl, lang]);

  // ─── Delete handler (admin) ───
  const handleDelete = useCallback(async (id: number, title: string) => {
    if (!confirm(lang === "ar"
      ? `هل أنت متأكد من حذف "${title}"؟ لا يمكن التراجع.`
      : `Are you sure you want to delete "${title}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteReference.mutateAsync({ id });
      toast.success(lang === "ar" ? "تم حذف الملف" : "File deleted");
      refetch();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Delete failed";
      toast.error(errMsg);
    }
  }, [deleteReference, refetch, lang]);

  // ─── Stats ───
  const totalFiles = data?.items?.length || 0;
  const totalDownloads = useMemo(() => {
    return (data?.items || []).reduce((sum: number, item: ReferenceFile) => sum + item.downloadCount, 0);
  }, [data]);

  return (
    <>
      <Seo
        title={lang === "ar" ? "المراجع | منصة الباز" : "References | Elbaz Platform"}
        description={lang === "ar"
          ? "مكتبة المراجع الهندسية — كتب PDF، جداول Excel، ملفات AutoCAD، وأكثر"
          : "Engineering reference library — PDF books, Excel spreadsheets, AutoCAD files, and more"}
      />

      <div className="min-h-screen bg-[#0a0e17] text-[#e8f0fe]">
        {/* ─── Hero Section ─── */}
        <div className="relative overflow-hidden border-b border-[#1e2d3d] bg-gradient-to-br from-cyan-600/10 to-blue-600/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.15),transparent_60%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25">
                    <FileBox className="h-7 w-7 text-white" />
                  </div>
                  <h1 className="text-3xl font-bold text-white md:text-4xl">
                    {lang === "ar" ? "المراجع الهندسية" : "Engineering References"}
                  </h1>
                </div>
                <p className="max-w-2xl text-sm text-slate-400 md:text-base">
                  {lang === "ar"
                    ? "مكتبة شاملة من الملفات الهندسية: كتب PDF، جداول Excel، ملفات AutoCAD، عروض تقديمية، وأكثر. حمّل ما تحتاجه لمساعدتك في دراستك وعملك."
                    : "A comprehensive library of engineering files: PDF books, Excel spreadsheets, AutoCAD files, presentations, and more. Download what you need for your studies and work."}
                </p>
              </div>

              {/* Stats */}
              <div className="flex gap-4">
                <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] px-5 py-3 text-center">
                  <div className="text-2xl font-bold text-cyan-400">{totalFiles}</div>
                  <div className="text-xs text-slate-500">{lang === "ar" ? "ملف" : "Files"}</div>
                </div>
                <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] px-5 py-3 text-center">
                  <div className="text-2xl font-bold text-green-400">{totalDownloads}</div>
                  <div className="text-xs text-slate-500">{lang === "ar" ? "تنزيل" : "Downloads"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Controls Bar ─── */}
        <div className="sticky top-0 z-20 border-b border-[#1e2d3d] bg-[#0a0e17]/95 backdrop-blur-md">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {/* Search */}
              <div className="relative flex-1 md:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={lang === "ar" ? "ابحث في المراجع..." : "Search references..."}
                  className="pl-10 bg-[#0d1521] border-[#1e2d3d] text-[#e8f0fe] placeholder:text-slate-500"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Category Filter */}
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="rounded-lg border border-[#1e2d3d] bg-[#0d1521] px-3 py-2 text-sm text-[#e8f0fe] focus:border-cyan-500/50 focus:outline-none"
                >
                  <option value="all">{lang === "ar" ? "كل الفئات" : "All categories"}</option>
                  {(categories || []).map((cat: string) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>

                {/* Upload Button (admin only) */}
                {isAdmin && (
                  <Button
                    onClick={() => setShowUploadModal(true)}
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:shadow-lg hover:shadow-cyan-500/25"
                  >
                    <Upload className="h-4 w-4 mr-1.5" />
                    {lang === "ar" ? "رفع ملف" : "Upload File"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ─── Files Grid ─── */}
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
              <span className="ml-3 text-slate-400">{lang === "ar" ? "جارٍ التحميل..." : "Loading..."}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileBox className="h-16 w-16 text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-slate-300 mb-1">
                {search || selectedCategory !== "all"
                  ? (lang === "ar" ? "لا توجد نتائج" : "No results found")
                  : (lang === "ar" ? "لا توجد ملفات بعد" : "No files yet")}
              </h3>
              <p className="text-sm text-slate-500">
                {search || selectedCategory !== "all"
                  ? (lang === "ar" ? "جرب تغيير البحث أو الفئة" : "Try changing your search or category")
                  : (lang === "ar" ? "سيتم إضافة الملفات قريباً" : "Files will be added soon")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item: ReferenceFile) => (
                <div
                  key={item.id}
                  className="group relative flex flex-col rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-5 transition-all hover:border-cyan-500/30 hover:bg-[#111827] hover:shadow-lg hover:shadow-cyan-500/5"
                >
                  {/* File icon + extension badge */}
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#1a2434]">
                      {getFileIcon(item.fileType)}
                    </div>
                    <span className="rounded-md bg-[#1a2434] px-2 py-1 text-[10px] font-bold text-slate-400">
                      {getFileExtension(item.fileName)}
                    </span>
                  </div>

                  {/* Title + description */}
                  <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-[#e8f0fe]" title={item.title}>
                    {item.title}
                  </h3>
                  {item.description && (
                    <p className="mb-3 line-clamp-2 text-xs text-slate-500" title={item.description}>
                      {item.description}
                    </p>
                  )}

                  {/* File meta */}
                  <div className="mt-auto space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="truncate" title={item.fileName}>{item.fileName}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{formatFileSize(item.fileSize)}</span>
                      <span className="flex items-center gap-1">
                        <HardDriveDownload className="h-3 w-3" />
                        {item.downloadCount}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={() => handleDownload(item.id, item.fileName)}
                        disabled={downloadingId === item.id}
                        className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:shadow-md hover:shadow-cyan-500/20"
                        size="sm"
                      >
                        {downloadingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1.5">{lang === "ar" ? "تنزيل" : "Download"}</span>
                      </Button>

                      {isAdmin && (
                        <Button
                          onClick={() => handleDelete(item.id, item.title)}
                          variant="outline"
                          size="sm"
                          className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Category badge */}
                  {item.category && item.category !== "general" && (
                    <span className="absolute top-3 right-3 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                      {item.category}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Upload Modal (admin) ─── */}
      {showUploadModal && isAdmin && (
        <UploadModal
          lang={lang}
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => {
            setShowUploadModal(false);
            refetch();
            toast.success(lang === "ar" ? "تم رفع الملف بنجاح" : "File uploaded successfully");
          }}
          getUploadUrl={getUploadUrl}
          createReference={createReference}
        />
      )}
    </>
  );
}

/* ─── Upload Modal Component ─── */

interface UploadModalProps {
  readonly lang: "en" | "ar";
  readonly onClose: () => void;
  readonly onUploaded: () => void;
  readonly getUploadUrl: { mutateAsync: (input: { fileName: string; fileType: string; fileSize: number }) => Promise<{ uploadUrl: string; objectKey: string }> };
  readonly createReference: { mutateAsync: (input: {
    title: string;
    description?: string;
    fileName: string;
    fileKey: string;
    fileType: string;
    fileSize: number;
    category?: string;
    isPublic?: boolean;
    sortOrder?: number;
  }) => Promise<{ success: boolean; id: number }> };
}

function UploadModal({ lang, onClose, onUploaded, getUploadUrl, createReference }: UploadModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      if (!title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error(lang === "ar" ? "اختر ملفاً أولاً" : "Please select a file first");
      return;
    }
    if (!title.trim()) {
      toast.error(lang === "ar" ? "أدخل عنواناً للملف" : "Please enter a title");
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      // Step 1: Get presigned upload URL
      const { uploadUrl, objectKey } = await getUploadUrl.mutateAsync({
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
      });

      setProgress(30);

      // Step 2: Upload file directly to R2 via PUT
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(30 + Math.round((e.loaded / e.total) * 50));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: HTTP ${xhr.status} - ${xhr.responseText}`));
          }
        };

        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });

      setProgress(85);

      // Step 3: Create DB record
      await createReference.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        fileName: file.name,
        fileKey: objectKey,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        category: category.trim() || "general",
        isPublic: true,
        sortOrder: 0,
      });

      setProgress(100);
      onUploaded();
    } catch (err) {
      console.error("[References] Upload failed:", err);
      const errMsg = err instanceof Error ? err.message : "Upload failed";
      toast.error(errMsg);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#1e2d3d] bg-[#0d1521] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {lang === "ar" ? "رفع ملف مرجعي" : "Upload Reference File"}
          </h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4">
          {/* File selector */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              {lang === "ar" ? "الملف" : "File"} <span className="text-red-400">*</span>
            </label>
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#1e2d3d] bg-[#0a0e17] px-4 py-8 text-center transition-colors hover:border-cyan-500/40"
            >
              {file ? (
                <>
                  <FileText className="mb-2 h-10 w-10 text-cyan-400" />
                  <p className="text-sm text-[#e8f0fe]">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                </>
              ) : (
                <>
                  <Upload className="mb-2 h-10 w-10 text-slate-500" />
                  <p className="text-sm text-slate-400">
                    {lang === "ar" ? "اضغط لاختيار ملف" : "Click to select a file"}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {lang === "ar" ? "PDF, DOCX, XLSX, JPG, PNG, ZIP, RAR — حتى 50MB" : "PDF, DOCX, XLSX, JPG, PNG, ZIP, RAR — up to 50MB"}
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.rtf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.svg,.zip,.rar,.7z,.tar,.gz,.json,.xml,.dwg,.dxf,.stl"
            />
          </div>

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              {lang === "ar" ? "العنوان" : "Title"} <span className="text-red-400">*</span>
            </label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={uploading}
              placeholder={lang === "ar" ? "مثال: دليل ETAP الكامل" : "e.g., Complete ETAP Guide"}
              className="bg-[#0a0e17] border-[#1e2d3d] text-[#e8f0fe]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              {lang === "ar" ? "الوصف" : "Description"}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={uploading}
              rows={2}
              placeholder={lang === "ar" ? "وصف مختصر للمحتوى..." : "Brief description of the content..."}
              className="w-full rounded-lg border border-[#1e2d3d] bg-[#0a0e17] px-3 py-2 text-sm text-[#e8f0fe] placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              {lang === "ar" ? "الفئة" : "Category"}
            </label>
            <Input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={uploading}
              placeholder={lang === "ar" ? "مثال: electrical, software, general" : "e.g., electrical, software, general"}
              className="bg-[#0a0e17] border-[#1e2d3d] text-[#e8f0fe]"
            />
          </div>

          {/* Progress bar */}
          {uploading && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>{lang === "ar" ? "جارٍ الرفع..." : "Uploading..."}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#1a2434]">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex gap-3">
          <Button
            onClick={onClose}
            disabled={uploading}
            variant="outline"
            className="flex-1 border-[#1e2d3d] text-slate-400 hover:bg-white/5"
          >
            {lang === "ar" ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={uploading || !file || !title.trim()}
            className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="ml-1.5">{lang === "ar" ? "رفع" : "Upload"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
