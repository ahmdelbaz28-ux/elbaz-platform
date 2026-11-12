/**
 * SubscribeGate — the HARD "subscribe to the channel before watching" screen
 * that takes the video slot until the viewer unlocks (see
 * src/lib/subscribe-gate.ts). ═══════════════════════════════════════════════
 *
 * Owner contract (2026): REQUIRED subscription, enforced — NOT skippable.
 *   • No «أنا مشترك بالفعل» bypass button: the ONLY unlock path is
 *     «اشترك الآن في اليوتيوب» (opens YouTube's NATIVE confirm-subscription
 *     dialog ?sub_confirmation=1) → then «اشتركت — افتح الفيديوهات».
 *   • If the viewer already pressed «اشتراك الآن» (went back / reloaded,
 *     same tab, within the flow TTL) the confirm step shows directly —
 *     re-running the whole dialog is pointless friction, not a bypass.
 *   • After unlocking, the device stays unlocked for `days` (admin window) —
 *     an already-subscribed viewer is never re-asked inside that window.
 *   • Respectful wording throughout: the gate asks for support, never
 *     threatens; YouTube gives no non-invasive way to VERIFY a subscription,
 *     so the flow enforces the click, not a fake "verification".
 */
import { useState } from "react";
import { BellRing, Youtube } from "lucide-react";
import {
  buildSubscribeUrl,
  hasPressedSubscribe,
  markSubscribePressed,
} from "@/lib/subscribe-gate";
import { trackEvent } from "@/lib/clarity";

interface SubscribeGateProps {
  readonly lang: "en" | "ar";
  readonly channelUrl: string;
  /** Days the unlock stays valid on this device (from admin settings). */
  readonly days: number;
  /** Called after the viewer unlocks (confirm button) — parent mounts the player. */
  readonly onUnlocked: () => void;
}

export default function SubscribeGate({ lang, channelUrl, days, onUnlocked }: SubscribeGateProps) {
  // Pre-arm the confirm step when the subscribe button was ALREADY pressed on
  // this device/tab (back-navigation, reload). React purity rule: no
  // Date.now() outside event handlers/effects — hasPressedSubscribe() reads
  // storage, which is an external read, and defaults internally to now().
  const [visitedChannel, setVisitedChannel] = useState(() => hasPressedSubscribe());
  const isAr = lang === "ar";

  const openChannel = () => {
    trackEvent("subscribe_gate_open_channel", { channelUrl });
    globalThis.open(buildSubscribeUrl(channelUrl), "_blank", "noopener,noreferrer");
    markSubscribePressed();
    setVisitedChannel(true);
  };

  const confirmSubscribed = () => {
    trackEvent("subscribe_gate_unlock", { via: "subscribe-flow", days });
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
        {isAr
          ? "اشترك في القناة أولاً — ثم افتح الفيديوهات"
          : "Subscribe to the channel first — then watch"}
      </h3>
      <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#94a3b8] sm:text-sm">
        {isAr
          ? "كل الفيديوهات بتبثّ مباشرة من قناة اليوتيوب جوه المنصة، واشتراكك مجاني هو مفتاح المشاهدة: اضغط زر الاشتراك، تفتح لك صفحة القناة على اليوتيوب بد dialog الاشتراك الجاهز — دوس اشتراك وقفّل الجرس 🔔 وارجع هنا."
          : "Every video streams directly from the YouTube channel inside the platform, and your free subscription is the key: press the subscribe button, YouTube opens with the ready-to-confirm dialog — subscribe, hit the bell 🔔, and come back here."}
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
            onClick={confirmSubscribed}
            className="inline-flex min-h-11 w-full animate-in fade-in slide-in-from-bottom-2 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-4 py-2.5 text-sm font-bold text-[#04121c] transition-transform hover:scale-[1.02] active:scale-[0.99]"
            data-testid="subscribe-gate-unlock"
          >
            <BellRing className="h-4 w-4" aria-hidden="true" />
            {isAr ? "اشتركت — افتح الفيديوهات" : "Done — open the videos"}
          </button>
        )}
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-[#5b6b85]">
        {isAr
          ? `الفيديوهات مغلقة لحد ما تكمّل الاشتراك${days > 0 ? ` — وبعد ما تشترك مرة على الجهاز ده مش هنرد اسألك لمدة ${days} يوم` : ""}`
          : `Videos stay locked until the subscribe flow is done${days > 0 ? ` — once subscribed on this device we won't ask again for ${days} days` : ""}`}
      </p>
    </div>
  );
}
