export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#070b12] pt-24 pb-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        <div className="h-8 bg-[#1f2d44] rounded w-1/3 mb-8 animate-pulse" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[#1f2d44] bg-[#0d1420] overflow-hidden">
              <div className="aspect-video bg-[#1f2d44] animate-pulse" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-[#1f2d44] rounded w-3/4 animate-pulse" />
                <div className="h-3 bg-[#1f2d44] rounded w-full animate-pulse" />
                <div className="h-3 bg-[#1f2d44] rounded w-1/2 animate-pulse" />
                <div className="flex justify-between pt-2">
                  <div className="h-5 bg-[#1f2d44] rounded w-20 animate-pulse" />
                  <div className="h-5 bg-[#1f2d44] rounded w-16 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
