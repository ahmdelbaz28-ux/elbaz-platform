import { useEffect, useRef } from "react";

interface ScadaGaugeProps {
  value: number;
  label: string;
  suffix?: string;
  color?: string;
  enabled?: boolean;
}

export default function ScadaGauge({
  value,
  label,
  suffix = "",
  color = "#06b6d4",
  enabled = true,
}: ScadaGaugeProps) {
  const displayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!enabled || !displayRef.current) return;
    let start = 0;
    const duration = 2000;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(eased * value);
      if (displayRef.current) {
        displayRef.current.textContent = current.toLocaleString();
      }
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, enabled]);

  if (!enabled) {
    // Fallback to standard counter
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-3xl font-bold text-[#f0f4f8]">{value.toLocaleString()}{suffix}</span>
        <span className="text-xs text-[#64748b]">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* SCADA display panel */}
      <div
        className="relative rounded-lg border px-4 py-2 font-mono text-3xl font-bold tracking-widest"
        style={{
          backgroundColor: `${color}10`,
          borderColor: `${color}40`,
          color: color,
          boxShadow: `0 0 12px ${color}30, inset 0 0 16px ${color}08`,
          textShadow: `0 0 8px ${color}`,
        }}
      >
        {/* Scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-lg opacity-10"
          style={{
            background: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${color} 2px, ${color} 3px)`,
          }}
        />
        {/* Blinking cursor before value */}
        <span className="relative">
          <span ref={displayRef}>0</span>
          <span className="ml-0.5 text-lg">{suffix}</span>
        </span>
        {/* Status LED */}
        <span
          className="absolute -top-1.5 -right-1.5 flex h-3 w-3 items-center justify-center"
        >
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: "#10b981" }}
          />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: "#10b981" }} />
        </span>
      </div>
      {/* Label with "SYSTEM STABLE" dot */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-widest text-[#64748b]">{label}</span>
      </div>
    </div>
  );
}
