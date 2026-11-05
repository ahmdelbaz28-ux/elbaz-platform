/**
 * SubscribeGate — the respectful "support the channel" screen that takes the
 * video slot until the viewer unlocks (see src/lib/subscribe-gate.ts).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * UX contract (owner requirement: required subscription, but NEVER annoying):
 *   • Shown once per device per unlock-window (default 30 days), not per video.
 *   • The primary button opens YouTube with the channel's NATIVE
 *     confirm-subscription dialog (?sub_confirmation=1) — subscribing is one
 *     tap there, then one tap back here on «فتح الفيديوهات».
 *   • Already-subscribed viewers unlock instantly via «أنا مشترك بالفعل».
 *   • Honest wording: we never claim to VERIFY the subscription — YouTube
 *     gives no such API — the copy asks for support instead of threatening.
 */
import { useState } from "react";
import { BellRing, Youtube } from "lucide-react";
import { buildSubscribeUrl } from "@/lib/subscribe-gate";
import { trackEvent } from "@/lib/clarity";

interface SubscribeGateProps {
  readonly lang: "en" | "ar";
  readonly channelUrl: string;
  /** Days the unlock stays valid on this device (from admin settings). */
  readonly days: number;
  /** Called after the viewer unlocks (button press) — parent mounts the player. */
  readonly onUnlocked: () => void;
}

export default function SubscribeGate({ lang, channelUrl, days, onUnlocked }: SubscribeGateProps) {
  const [visitedChannel, setVisitedChannel] = useState(false);
  const isAr = lang === "ar";

  const openChannel = () => {
    trackEvent("subscribe_gate_open_channel", { channelUrl });
    globalThis.open(buildSubscribeUrl(channelUrl), "_blank", "noopener,noreferrer");
    setVisitedChannel(true);
  };

  const unlock = (via: "confirm" | "already") => {
    trackEvent("subscribe_gate_unlock", { via, days });
    onUnlocked();
  };

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-[#0a1220] via-[#0d1526] to-[#101b30] px-4 py-6 text-center"
      data-testid="subscribe-gate"
      role="dialog"
      aria-label={isAr ? "اشترك في القناة لمتابعة الفيديوهات" : "Subscribe to the channel to continue watching"}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[rgba(255,59,48,0.12)] ring-1 ring-[rgba(255,59,48,0.35)]">
        <Youtube className="h-8 w-8 text-[#ff5f57]" aria-hidden="true" />
      </div>

      <h3 className="mt-3 text-base font-bold text-[#f0f4f8] sm:text-lg">
        {isAr ? "اشترك في قناة المهندس أحمد الباز وابدأ المشاهدة" : "Subscribe to Eng. Ahmed Elbaz's channel to start watching"}
      </h3>
      <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#94a3b8] sm:text-sm">
        {isAr
          ? "كل الفيديوهات بتبثّ مباشرة من قناة اليوتيوب جوه المنصة. اشترك مجاناً وقفّل الجرس 🔔 عشان يوصلك كل درس جديد — دي أكبر مساعدة تقدر تدعمنا بيها نكمل الشرح."
          : "Every video streams directly from the YouTube channel inside the platform. Subscribe for free and hit the bell 🔔 so new lessons reach you — it's the biggest support you can give us."}
      </p>

      <div className="mt-5 flex w-full max-w-xs flex-col gap-2.5">
        <button
          type="button"
          onClick={openChannel}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#ff0000] px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(255,0,0,0.25)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
          data-testid="subscribe-gate-open"
        >
          <Youtube className="h-5 w-5" aria-hidden="true" />
          {isAr ? "اشترك الآن في اليوتيوب" : "Subscribe on YouTube"}
        </button>

        {visitedChannel && (
          <button
            type="button"
            onClick={() => unlock("confirm")}
            className="inline-flex min-h-11 w-full animate-in fade-in slide-in-from-bottom-2 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-4 py-2.5 text-sm font-bold text-[#04121c] transition-transform hover:scale-[1.02] active:scale-[0.99]"
            data-testid="subscribe-gate-unlock"
          >
            <BellRing className="h-4 w-4" aria-hidden="true" />
            {isAr ? "اشتركت — افتح الفيديوهات" : "Done — open the videos"}
          </button>
        )}

        <button
          type="button"
          onClick={() => unlock("already")}
          className="min-h-11 w-full rounded-xl px-4 py-2 text-xs font-medium text-[#7c8aa5] underline-offset-4 transition-colors hover:text-[#22d3ee] hover:underline"
          data-testid="subscribe-gate-already"
        >
          {isAr ? "أنا مشترك بالفعل — افتح الفيديوهات" : "I'm already subscribed — open the videos"}
        </button>
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-[#5b6b85]">
        {isAr
          ? `مرة واحدة بس على الجهاز ده${days > 0 ? ` — مش هنرد اسألك تاني لمدة ${days} يوم` : ""}`
          : `Asked once on this device${days > 0 ? ` — we won't ask again for ${days} days` : ""}`}
      </p>
    </div>
  );
}
