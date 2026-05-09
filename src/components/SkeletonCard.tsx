export function CourseCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1f2d44] bg-[#0d1420] overflow-hidden">
      <div className="aspect-video bg-[#1f2d44] animate-pulse" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-[#1f2d44] rounded w-3/4 animate-pulse" />
        <div className="h-3 bg-[#1f2d44] rounded w-1/2 animate-pulse" />
        <div className="flex justify-between items-center pt-2">
          <div className="h-5 bg-[#1f2d44] rounded w-20 animate-pulse" />
          <div className="h-5 bg-[#1f2d44] rounded w-16 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
