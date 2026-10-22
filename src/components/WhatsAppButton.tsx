import { useState, useEffect, useRef } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useContactSettings } from "@/hooks/useContactSettings";
import { useFabScrollVisibility } from "@/hooks/useFabScrollVisibility";
import { useLocation } from "react-router";
import { MessageCircle, X } from "lucide-react";

// Gentle entrance delay — let the page settle first, then glide the
// WhatsApp FAB in to catch the eye (owner request: 3s + soft animation).
const ENTRANCE_DELAY_MS = 3000;
// Proactive welcome bubble: pops shortly after the button entrance, then
// auto-dismisses. Shown once per page load; a manual close persists for the
// whole browser session (owner request: custom welcome message).
const WELCOME_DELAY_MS = 1400;
const WELCOME_AUTOHIDE_MS = 14000;
const WELCOME_DISMISS_KEY = "wa-welcome-dismissed";

export default function WhatsAppButton() {
  const { lang } = useTranslation();
  const { data: contact } = useContactSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [appeared, setAppeared] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const welcomeDone = useRef(false);

  const location = useLocation();
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register" || location.pathname === "/forgot-password" || location.pathname === "/reset-password" || location.pathname === "/verify-email";

  useEffect(() => {
    if (isAuthPage) return;
    const timer = setTimeout(() => setAppeared(true), ENTRANCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isAuthPage]);

  // Never render on auth pages; also fixes the old bug where the delay
  // timer re-showed the button on /login after it had been hidden.
  const isVisible = appeared && !isAuthPage;

  // ── Proactive welcome bubble (custom greeting) ──
  // Appears once shortly after the FAB entrance, auto-dismisses after 14s,
  // and never comes back once closed manually (session persistence) or once
  // the visitor opened the tooltip / started a chat.
  useEffect(() => {
    if (!isVisible || isOpen) return undefined;
    try {
      if (sessionStorage.getItem(WELCOME_DISMISS_KEY) === "1") return undefined;
    } catch {
      /* private mode — still show the bubble for this visit */
    }
    const showTimer = setTimeout(() => {
      if (!welcomeDone.current) setWelcomeVisible(true);
    }, WELCOME_DELAY_MS);
    const hideTimer = setTimeout(() => {
      welcomeDone.current = true;
      setWelcomeVisible(false);
    }, WELCOME_DELAY_MS + WELCOME_AUTOHIDE_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isVisible, isOpen]);

  // Opening the tooltip (or navigating) permanently retires the bubble.
  useEffect(() => {
    if (!isOpen) return;
    welcomeDone.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- retiring the bubble synchronously prevents a one-frame flash when the tooltip opens
    setWelcomeVisible(false);
  }, [isOpen]);

  const dismissWelcome = () => {
    welcomeDone.current = true;
    setWelcomeVisible(false);
    try {
      sessionStorage.setItem(WELCOME_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // YouTube-style: dip below the edge while scrolling down, glide back on
  // stop — but never hide while the tooltip popup is open.
  const fabHidden = useFabScrollVisibility(isOpen);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen]);

  const message = lang === "en" ? contact.whatsappMessageEn : contact.whatsappMessageAr;
  const whatsappUrl = `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(message)}`;

  if (!isVisible) return null;

  return (
    <div
      className={`whatsapp-fab-wrap whatsapp-fab-enter fixed z-[90] transform-gpu will-change-transform ${
        fabHidden ? "fab-scroll-hidden" : ""
      }`}
    >
      {/* Proactive welcome bubble — custom greeting that pops in above the
          button shortly after entrance. Click = open the chat popup. */}
      <div
        id="whatsapp-welcome"
        role="status"
        aria-hidden={!welcomeVisible || isOpen}
        className={`absolute bottom-12 md:bottom-16 mb-2 w-60 right-0 md:right-auto md:left-0 rounded-xl border border-[#1e2d3d] bg-[#0d1420] p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.55)] md:w-64 ${
          welcomeVisible && !isOpen
            ? "wa-welcome-bubble pointer-events-auto"
            : "pointer-events-none opacity-0"
        }`}
      >
        <div className="absolute -bottom-2 right-3 h-4 w-4 rotate-45 border-b border-r border-[#1e2d3d] bg-[#0d1420] md:right-auto md:left-5" />

        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[#f0f4f8]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25D366] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#25D366]" />
            </span>
            {lang === "en" ? "Elbaz Platform Team" : "فريق منصة الباز"}
          </span>
          <button
            type="button"
            onClick={dismissWelcome}
            aria-label={lang === "en" ? "Dismiss greeting" : "إغلاق الترحيب"}
            className="text-[#64748b] transition-colors hover:text-[#f0f4f8]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="block w-full text-start text-xs leading-relaxed text-[#94a3b8]"
        >
          {lang === "en"
            ? "Welcome! Need engineering advice or a quick question about a course? Message us on WhatsApp — we usually reply within minutes."
            : "أهلاً بك! محتاج استشارة هندسية أو عندك سؤال عن الكورسات؟ ابعتلنا واتساب وهنرد عليك خلال دقائق."}
        </button>
      </div>

      {/* Tooltip popup */}
      <div
        id="whatsapp-tooltip"
        role="tooltip"
        aria-hidden={!isOpen}
        className={`absolute bottom-12 md:bottom-16 mb-2 w-64 right-0 md:right-auto md:left-0 rounded-xl border border-[#1e2d3d] bg-[#0d1420] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.5)] transition-all duration-300 md:w-72 ${
          isOpen
            ? "translate-y-0 opacity-100 scale-100 pointer-events-auto"
            : "translate-y-2 opacity-0 scale-95 pointer-events-none"
        }`}
      >
        {/* Arrow — anchored under the button center on each breakpoint
            (mobile: stack sits on the right; desktop: button on the left) */}
        <div className="absolute -bottom-2 right-3 h-4 w-4 rotate-45 border-b border-r border-[#1e2d3d] bg-[#0d1420] md:right-auto md:left-5" />

        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366]">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#f0f4f8]">
              {lang === "en" ? "Need help?" : "محتاج مساعدة؟"}
            </p>
          </div>
        </div>
        <p className="text-xs text-[#94a3b8] leading-relaxed">
          {lang === "en"
            ? "Chat with us directly on WhatsApp. We typically respond within minutes during working hours."
            : "تواصل معنا مباشرة على واتساب. عادة نرد خلال دقائق خلال ساعات العمل."}
        </p>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#20BA5A] hover:shadow-[0_0_20px_rgba(37,211,102,0.3)]"
        >
          <MessageCircle className="h-4 w-4" />
          {lang === "en" ? "Start Chat" : "ابدأ المحادثة"}
        </a>
      </div>

      {/* Floating button */}
      <button
        type="button" onClick={() => setIsOpen(!isOpen)}
        aria-label={lang === "en" ? "Open WhatsApp chat" : "فتح محادثة واتساب"}
        aria-expanded={isOpen}
        aria-controls="whatsapp-tooltip"
        className="whatsapp-fab transform-gpu will-change-transform flex h-10 w-10 md:h-14 md:w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_4px_24px_rgba(37,211,102,0.4)] transition-all duration-300 hover:scale-110 hover:shadow-[0_8px_32px_rgba(37,211,102,0.5)] active:scale-95"
      >
        {isOpen ? (
          <X className="h-4 w-4 md:h-6 md:w-6" />
        ) : (
          <svg className="h-5 w-5 md:h-7 md:w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
        )}
      </button>

      {/* Pulse ring */}
      {!isOpen && (
        <span className="whatsapp-pulse absolute inset-0 rounded-full bg-[#25D366]" />
      )}
    </div>
  );
}
