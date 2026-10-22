import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { useChatFabAnimation } from "@/hooks/useChatFabAnimation";
import { useFabScrollVisibility } from "@/hooks/useFabScrollVisibility";
import {
  X,
  Send,
  Bot,
  User,
  Loader2,
  Zap,
  ChevronDown,
  Trash2,
  Copy,
  RotateCcw,
  Brain,
  Rocket,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  timestamp: Date;
  model?: string;
  isError?: boolean;
}

// ─── localStorage persistence ───────────────────────────────────────────────

const STORAGE_KEY = "elbaz_chat_history";
const MODE_STORAGE_KEY = "elbaz_chat_mode";
const MAX_STORAGE_MESSAGES = 50;
// Max time a FAB click waits for the auth check before treating the visitor
// as logged out (dead-man switch — guarantees the FAB can never be a dead
// button, even if the auth check hangs or loops).
const AUTH_LOADING_DEADMAN_MS = 4000;

type ChatMode = "thinking" | "instant";

function loadChatMode(): ChatMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "instant" || stored === "thinking") return stored;
  } catch {
    // Intentionally ignored: localStorage unavailable — default to thinking. — SonarCloud S2486
  }
  return "thinking";
}

function saveChatMode(mode: ChatMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Intentionally ignored: localStorage unavailable — mode won't persist. — SonarCloud S2486
  }
}

function saveMessagesToStorage(msgs: Message[]): void {
  try {
    const serializable = msgs.slice(-MAX_STORAGE_MESSAGES).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
        model: m.model || undefined,
        isError: m.isError || undefined,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Intentionally ignored: localStorage may be full or unavailable — chat history is non-critical. — SonarCloud S2486
  }
}

function loadMessagesFromStorage(): Message[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((m: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: m.id || crypto.randomUUID(),
        role: m.role || "assistant",
        content: m.content || "",
        timestamp: new Date(m.timestamp || Date.now()),
        model: m.model || undefined,
        isError: m.isError || undefined,
      }));
  } catch {
    // Intentionally ignored: corrupt or unreadable storage — return null so caller re-initializes. — SonarCloud S2486
    return null;
  }
}

// ─── Text direction + Markdown to HTML (regex-based, no library) ─────────────
// Bidi support: any message containing Arabic script renders RTL (the reader
// reads from the right, as Arabic). Latin runs inside an RTL paragraph are
// isolated automatically by the Unicode bidi algorithm; code blocks and inline
// code are pinned LTR so terminal-style content stays readable in both
// directions. Markdown supports: fenced code blocks, inline code, **bold**
// (rendered as cyan-highlighted key terms), *italic*, ### headings, numbered
// step lists ("1. …"), bullet lists ("- " / "• "), and paragraphs.

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#x27;");
}

/** Inline markdown (code / bold / italic) — input must already be escaped. */
function renderInline(md: string): string {
  // Inline code first, so ** inside code is never bolded. dir="ltr" isolates
  // the code run from the surrounding RTL/LTR paragraph.
  let html = md.replaceAll(/`([^`]+)`/g, '<code dir="ltr" class="bg-black/30 border border-[#1e2d3d] px-1.5 py-0.5 rounded text-[12px] text-cyan-300">$1</code>');
  // Bold → highlighted key term (the UI colors important words cyan)
  html = html.replaceAll(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-cyan-300">$1</strong>');
  // Italic
  html = html.replaceAll(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return html;
}

/**
 * Render a non-code text segment: headings, numbered step lists, bullet lists
 * and paragraphs. Line-based so the model's "1. step" instructions render as
 * real ordered steps (with a number badge) instead of a wall of text.
 */
function renderTextBlock(text: string): string {
  const lines = text.split("\n");
  let out = "";
  let mode: "none" | "ol" | "ul" = "none";
  let para: string[] = [];

  const closeList = () => {
    if (mode === "ol") out += "</ol>";
    else if (mode === "ul") out += "</ul>";
    mode = "none";
  };
  const flushPara = () => {
    if (para.length) {
      out += `<p>${para.join("<br>")}</p>`;
      para = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const step = /^(\d{1,2})[.)]\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);

    if (heading) {
      flushPara();
      closeList();
      out += `<h4 class="chat-h">${renderInline(heading[1])}</h4>`;
    } else if (step) {
      flushPara();
      if (mode !== "ol") {
        closeList();
        out += '<ol class="chat-ol">';
        mode = "ol";
      }
      out += `<li data-n="${step[1]}">${renderInline(step[2])}</li>`;
    } else if (bullet) {
      flushPara();
      if (mode !== "ul") {
        closeList();
        out += '<ul class="chat-ul">';
        mode = "ul";
      }
      out += `<li>${renderInline(bullet[1])}</li>`;
    } else if (!line) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(renderInline(line));
    }
  }
  flushPara();
  closeList();
  return out;
}

function renderMarkdown(text: string): string {
  // While streaming, a fence may be momentarily unclosed — close it so the
  // partial code renders as a block instead of leaking raw backticks.
  let src = text;
  const fenceCount = (src.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) src += "\n```";

  // S8786: regex is intentionally bounded; `[\s\S]*?` is the canonical
  // non-backtracking pattern for delimited multiline captures.
  const segments = src.split(/```(\w*)[ \t]*\n?([\s\S]*?)```/); // NOSONAR — S8786: bounded lazy capture between ``` delimiters
  // segments: [text, lang, code, text, lang, code, …, text]
  let html = "";
  for (let i = 0; i < segments.length; i += 3) {
    html += renderTextBlock(segments[i]);
    if (segments[i + 2] !== undefined) {
      const code = escapeHtml(segments[i + 2].trim());
      html += `<pre dir="ltr" class="bg-black/40 border border-[#1e2d3d] rounded-lg p-2.5 my-1.5 overflow-x-auto text-[12px] leading-5 text-[#b4c6e0]" style="text-align:left"><code>${code}</code></pre>`;
    }
  }
  return html;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WELCOME_MESSAGES: Record<string, Message> = {
  en: {
    id: "welcome",
    role: "assistant",
    content:
      "Welcome to Elbaz Bot — your electrical engineering AI assistant.\n\nI can help you with:\n\u2022 Power systems analysis (load flow, short circuit, arc flash)\n\u2022 ETAP, SKM Power*Tools & DIgSILENT PowerFactory\n\u2022 Relay coordination & protection systems\n\u2022 Network analysis & fault studies\n\u2022 IEEE / IEC standards\n\nAsk me any electrical engineering question.",
    timestamp: new Date(),
  },
  ar: {
    id: "welcome",
    role: "assistant",
    content:
      "\u0645\u0631\u062d\u0628\u0627\u064b \u0628\u0643 \u0641\u064a \u0628\u0648\u062a \u0627\u0644\u0628\u0627\u0632 \u2014 \u0645\u0633\u0627\u0639\u062f\u0643 \u0627\u0644\u0630\u0643\u064a \u0644\u0644\u0647\u0646\u062f\u0633\u0629 \u0627\u0644\u0643\u0647\u0631\u0628\u064a\u0629.\n\n\u0623\u0633\u0637\u064a\u0639 \u0645\u0633\u0627\u0639\u062f\u062a\u0643 \u0641\u064a:\n\u2022 \u062a\u062d\u0644\u064a\u0644 \u0623\u0646\u0638\u0645\u0629 \u0627\u0644\u0642\u0648\u0649 (\u062a\u062f\u0641\u0642 \u0627\u0644\u0623\u062d\u0645\u0627\u0644\u060c \u0627\u0644\u062f\u0648\u0627\u0626\u0631 \u0627\u0644\u0642\u0635\u064a\u0631\u0629\u060c \u0627\u0644\u0642\u0648\u0633 \u0627\u0644\u0643\u0647\u0631\u0628\u064a)\n\u2022 \u0628\u0631\u0646\u0627\u0645\u062c ETAP \u0648 SKM Power*Tools \u0648 DIgSILENT PowerFactory\n\u2022 \u062a\u0646\u0633\u064a\u0642 \u0627\u0644\u0631\u064a\u0644\u064a\u0647 \u0648\u0623\u0646\u0638\u0645\u0629 \u0627\u0644\u062d\u0645\u0627\u064a\u0629\n\u2022 \u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0634\u0628\u0643\u0627\u062a \u0648\u062f\u0631\u0627\u0633\u0627\u062a \u0627\u0644\u0623\u0639\u0637\u0627\u0644\n\u2022 \u0645\u0639\u0627\u064a\u064a\u0631 IEEE \u0648 IEC\n\n\u0627\u0633\u0623\u0644\u0646\u064a \u0623\u064a \u0633\u0624\u0627\u0644 \u0641\u064a \u0627\u0644\u0647\u0646\u062f\u0633\u0629 \u0627\u0644\u0643\u0647\u0631\u0628\u064a\u0629.",
    timestamp: new Date(),
  },
};

const MAX_HISTORY = typeof import.meta.env.VITE_CHATBOT_MAX_HISTORY === "string"
  ? Math.max(10, Math.min(200, Number(import.meta.env.VITE_CHATBOT_MAX_HISTORY) || 50))
  : 50;

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChatBot() { // NOSONAR — chatbot component with SSE streaming, abort, copy, minimize, scroll-sync, localStorage; extraction would require prop-drilling many refs/state
  const { lang } = useTranslation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadMessagesFromStorage() || [WELCOME_MESSAGES[lang]]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("");
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string>("");
  const [chatMode, setChatMode] = useState<ChatMode>(loadChatMode);
  const [chunkIndex, setChunkIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string>(crypto.randomUUID());
  const abortControllerRef = useRef<AbortController | null>(null);
  // Bumped on clearChat — any in-flight sendMessage with an older generation
  // becomes stale and must NOT touch state afterwards (prevents the cleared
  // conversation from being partially re-populated by a late stream).
  const generationRef = useRef(0);
  const fabRef = useChatFabAnimation();
  // YouTube-style scroll hide for the FAB button — suspended while the chat
  // window (or its minimized bubble) is open so an active chat never dips away.
  const fabHidden = useFabScrollVisibility(isOpen);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingExitStartedRef = useRef(false);

  // ─── Typing indicator visibility (handles enter/exit animations) ───
  const [typingVisible, setTypingVisible] = useState(false);
  const [typingExiting, setTypingExiting] = useState(false);

  // ─── Scroll-follow state ───
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // ─── Stick-to-bottom auto-scroll (streaming + new messages) ───
  // useLayoutEffect runs BEFORE paint, so text growth and the scroll land in
  // the same frame — the conversation follows the streaming cursor with zero
  // flicker. If the user scrolls up to read, auto-follow pauses and a
  // "jump to latest" chip appears instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamingContent / typingVisible / messages.length are intentional TRIGGERS — the effect re-pins the scroll position whenever any of them changes (refs are read on purpose)
  useLayoutEffect(() => {
    if (!chatContainerRef.current || !stickToBottomRef.current) return;
    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [streamingContent, typingVisible, messages.length]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = chatContainerRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  // Track whether the user detached from the bottom (scrolled up to read).
  // A scroll event fired right after the container was RESIZED is a layout
  // clamp (the browser adjusting scrollTop during reflow — e.g. keyboard
  // open/close), not a user gesture — it must not break stick-to-bottom.
  const lastClientHeightRef = useRef(0);
  const handleMessagesScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    if (el.clientHeight !== lastClientHeightRef.current) {
      lastClientHeightRef.current = el.clientHeight;
      return;
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
    setShowJumpToLatest(distance > 140);
  }, []);

  // ─── Focus input when chat opens ───
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, isMinimized]);

  // ─── Scroll to latest when the chat opens ───
  useEffect(() => {
    if (isOpen && !isMinimized) {
      const t = setTimeout(() => scrollToBottom(false), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isOpen, isMinimized, scrollToBottom]);

  // ─── Keyboard-aware mobile sizing (visualViewport API) ───
  // When the on-screen keyboard opens, a fixed bottom-anchored window gets
  // covered on iOS (layout viewport unchanged) and squeezed on Android. We
  // track the visual viewport and, while the chat is open on a small screen,
  // pin the window's bottom just above the keyboard and give it the full
  // visual height — the conversation and whatever the user types stay visible.
  const [kb, setKb] = useState({ open: false, height: 0, offsetBottom: 0, small: false });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let maxSeen = Math.max(window.innerHeight, vv.height);
    const update = () => {
      maxSeen = Math.max(maxSeen, window.innerHeight, vv.height);
      const small = window.innerWidth < 768;
      const open = small && vv.height < maxSeen - 100;
      const offsetBottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setKb((prev) => {
        const next = { open, height: Math.round(vv.height), offsetBottom, small };
        return (prev.open === next.open && prev.height === next.height
          && prev.offsetBottom === next.offsetBottom && prev.small === next.small)
          ? prev
          : next;
      });
    };
    // rAF keeps the initial measurement out of the effect body (React 19 lint)
    const raf = requestAnimationFrame(update);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // When the keyboard opens, keep the latest message + the caret in view
  const prevKbOpenRef = useRef(false);
  useEffect(() => {
    if (kb.open && !prevKbOpenRef.current && isOpen) {
      requestAnimationFrame(() => {
        if (stickToBottomRef.current) scrollToBottom(false);
      });
    }
    prevKbOpenRef.current = kb.open;
  }, [kb.open, isOpen, scrollToBottom]);

  // Re-stick to bottom whenever the messages viewport itself resizes
  // (keyboard open/close, orientation change): the window height changes
  // without a scroll event, so a plain scroll listener would miss it.
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!isOpen || isMinimized || !el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, isMinimized]);

  // ─── Typing indicator: show with enter animation / hide with exit animation ───
  useEffect(() => {
    if (isLoading && !streamingContent) {
      // Cancel any pending exit timer & reset guard
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      typingExitStartedRef.current = false;
      setTypingExiting(false); // eslint-disable-line react-hooks/set-state-in-effect
      // Small RAF delay ensures DOM is ready for the enter animation to play
      requestAnimationFrame(() => {
        setTypingVisible(true);
      });
    } else if (streamingContent && typingVisible && !typingExitStartedRef.current) {
      // First chunk arrived — start exit animation (only ONCE)
      typingExitStartedRef.current = true;
      setTypingExiting(true);
      typingTimerRef.current = setTimeout(() => {
        setTypingVisible(false);
        setTypingExiting(false);
      }, 250); // match exit animation duration
    } else if (!isLoading) {
      setTypingVisible(false);
      setTypingExiting(false);
    }

    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [isLoading, streamingContent, typingVisible]);

  // ─── Increment chunk index on each streaming update (for fade animation) ───
  useEffect(() => {
    if (streamingContent) {
      setChunkIndex((i) => i + 1); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [streamingContent]);

  // ─── Clear copied tooltip after 2s ───
  useEffect(() => {
    if (copiedId) {
      const timer = setTimeout(() => setCopiedId(""), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [copiedId]);

  // ─── Extract short model name ───
  const getShortModelName = useCallback((modelId: string): string => {
    if (!modelId) return "";
    const parts = modelId.split("/");
    const name = parts.length > 1 ? parts[1] : modelId;
    // Strip `:free` suffix and any `:...` variant suffix. Using split +
    // shift avoids the `.*` greedy quantifier that SonarCloud S8786
    // flags for super-linear backtracking.
    const colonIdx = name.indexOf(":");
    return colonIdx === -1 ? name : name.slice(0, colonIdx);
  }, []);

  // ─── Copy message to clipboard ───
  const copyMessage = useCallback((msgId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(msgId);
    }).catch(() => {
      // Fallback: use textarea trick
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      // NOSONAR — S1874: fallback for non-secure contexts (HTTP) where
      // navigator.clipboard is unavailable. The primary path uses the
      // async Clipboard API above.
      document.execCommand("copy"); // NOSONAR — deprecated API used as fallback for non-secure contexts
      ta.remove();
      setCopiedId(msgId);
    });
  }, []);

  // ─── Send message (with streaming) ───
  const sendMessage = useCallback(async (overrideInput?: string) => { // NOSONAR — orchestrates streaming + fallback + abort + UI state; extraction would split inter-dependent closures and shared mutable locals (accumulated/buffer/streamError) across helpers, risking regressions
    const trimmed = (overrideInput || input).trim();
    if (!trimmed || isLoading) return;

    const generation = generationRef.current;
    const isStale = () => generationRef.current !== generation;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    // Update messages state
    setMessages((prev) => [...prev.slice(-MAX_HISTORY), userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");
    setActiveModel("");

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Build API messages
    const apiMessages = [...messages.slice(-20), userMessage]
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const requestBody = {
      messages: apiMessages,
      // Language mirror: reply in the language of the user's actual message,
      // not the site UI language (Arabic message → Arabic reply, etc.)
      language: ARABIC_RE.test(trimmed) ? "ar" : "en",
      chatId: chatIdRef.current,
      mode: chatMode,
    };

    // Create abort controller
    abortControllerRef.current = new AbortController();

    const addErrorMessage = (errText: string) => {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: errText,
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    };

    try {
      // ─── Try streaming endpoint first ───
      let streamSuccess = false;
      try {
        const streamResponse = await fetch(`${globalThis.Capacitor?.isNativePlatform() ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io") : ""}/api/chatbot/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });

        if (streamResponse.ok) {
          const reader = streamResponse.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let accumulated = "";
            let buffer = "";
            let streamError: string | null = null;
            let receivedModel = "";

            while (true) {
              if (isStale()) break; // chat was cleared mid-stream — stop consuming
              const result = await reader.read();
              if (result.done) break;

              buffer += decoder.decode(result.value, { stream: true });
              // Parse SSE lines
              const lines = buffer.split("\n");
              buffer = lines.pop() || ""; // Keep incomplete line in buffer

              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();

                if (payload === "[DONE]") {
                  continue;
                }

                try {
                  const parsed = JSON.parse(payload);
                  if (parsed.model) {
                    receivedModel = parsed.model;
                    setActiveModel(parsed.model);
                  } else if (parsed.text) {
                    accumulated += parsed.text;
                    setStreamingContent(accumulated);
                  } else if (parsed.error) {
                    streamError = parsed.error;
                  }
                } catch {
                  // Intentionally ignored: SSE payload is not valid JSON — treat as raw text chunk. — SonarCloud S2486
                  accumulated += payload;
                  setStreamingContent(accumulated);
                }
              }
            }

            // Process remaining buffer
            if (buffer.trim()) {
              const remainingLine = buffer.trim();
              if (remainingLine.startsWith("data: ")) {
                const remainingPayload = remainingLine.slice(6).trim();
                if (remainingPayload !== "[DONE]") {
                  try {
                    const rParsed = JSON.parse(remainingPayload);
                    if (rParsed.text) accumulated += rParsed.text;
                  } catch {
                    // Intentionally ignored: trailing payload is not valid JSON — append as raw text. — SonarCloud S2486
                    accumulated += remainingPayload;
                  }
                }
              }
            }

            if (!isStale()) {
              if (streamError || !accumulated.trim()) {
                // Both error and empty-response branches share the same
                // user-facing message (SonarCloud S1871 — merged with `||`).
                addErrorMessage(
                  lang === "ar"
                    ? "يبدو أن هناك ضغط على الشبكة، حاول إرسال رسالتك مرة أخرى ⚡"
                    : "The network seems busy. Please try sending your message again ⚡"
                );
              } else {
                const botMessage: Message = {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: accumulated.trim(),
                  timestamp: new Date(),
                  model: receivedModel || undefined,
                };
                setMessages((prev) => [...prev, botMessage]);
              }
            }
            streamSuccess = true;
          }
        }
      } catch {
        // Intentionally ignored: streaming endpoint failed — fall through to regular /api/chatbot endpoint. — SonarCloud S2486
        streamSuccess = false;
      }

      // ─── Fallback: regular /api/chatbot ───
      if (!streamSuccess) {
        setStreamingContent("");
        const response = await fetch(`${globalThis.Capacitor?.isNativePlatform() ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io") : ""}/api/chatbot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current?.signal,
        });

        const data = await response.json();

        if (data.success && data.reply) {
          if (data.model) setActiveModel(data.model);

          // ── Typewriter effect: simulate streaming for non-streaming fallback ──
          // When the streaming endpoint fails, the full reply arrives at once.
          // To keep the UX consistent (text appearing word-by-word), we reveal
          // the reply incrementally using a word-by-word interval.
          const fullReply = data.reply;
          const words = fullReply.split(/(\s+)/); // Split keeping whitespace
          let displayed = "";

          for (const word of words) {
            if (isStale() || abortControllerRef.current?.signal.aborted) break;
            displayed += word;
            setStreamingContent(displayed);

            // Vary the delay slightly to feel natural:
            // - Shorter delay for short words (a, the, و، في)
            // - Longer delay after punctuation
            const trimmed = word.trim();
            const isPunctuation = /[.!?,،؛:]/.test(trimmed);
            // Compute delay without a nested ternary (SonarCloud S3358).
            let delay: number;
            if (isPunctuation) {
              delay = 80;
            } else if (trimmed.length <= 2) {
              delay = 20;
            } else {
              delay = 35;
            }

            // Use a promise + setTimeout to yield to the event loop
            await new Promise<void>((resolve) => {
              setTimeout(resolve, delay);
            });
          }

          if (!isStale()) {
            const botMsg: Message = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: fullReply,
              timestamp: new Date(),
              model: data.model || undefined,
            };
            setMessages((prev) => [...prev, botMsg]);
          }
        } else if (!isStale()) {
          addErrorMessage(
            lang === "ar"
              ? "يبدو أن هناك ضغط على الشبكة، حاول إرسال رسالتك مرة أخرى ⚡"
              : "The network seems busy. Please try sending your message again ⚡"
          );
        }
      }
    } catch (error) {
      console.warn("ChatBot send failed:", error);
      // After clearChat the aborted request lands here — never surface an
      // error bubble into the freshly cleared conversation.
      if (!isStale()) {
        addErrorMessage(
          lang === "ar"
            ? "يبدو أن هناك ضغط على الشبكة، حاول إرسال رسالتك مرة أخرى ⚡"
            : "The network seems busy. Please try sending your message again ⚡"
        );
      }
    } finally {
      setIsLoading(false);
      setStreamingContent("");
      abortControllerRef.current = null;
    }
  }, [input, isLoading, messages, lang, chatMode]);

  // ─── Handle Enter key ───
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─── Handle textarea auto-resize ───
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  // ─── Persist messages to localStorage when they change ───
  useEffect(() => {
    if (messages.length > 0 && !isLoading) {
      saveMessagesToStorage(messages);
    }
  }, [messages, isLoading]);

  // ─── Clear chat ───
  // Must fully reset the conversation even while a response is streaming:
  // 1) bump generation → any in-flight sendMessage becomes stale and can no
  //    longer append messages/errors or resurrect old streamed text
  // 2) abort the active fetch → the SSE reader/typewriter stops immediately
  // 3) wipe state + storage
  const clearChat = () => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    chatIdRef.current = crypto.randomUUID();
    setMessages([WELCOME_MESSAGES[lang]]);
    setStreamingContent("");
    setActiveModel("");
    setCopiedId("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Intentionally ignored: clearChat must proceed even if localStorage is unavailable. — SonarCloud S2486 */ }
  };

  // ─── Toggle chat mode (Thinking/Instant) ───
  const toggleChatMode = useCallback((mode: ChatMode) => {
    setChatMode(mode);
    saveChatMode(mode);
  }, []);

  // ─── Handle FAB click: auth gate ───
  // ✅ FIX (dead click): track how long the auth check has been running.
  // Normally authLoading resolves in one network round-trip, but a stale
  // session used to trap it in a 401 refetch loop — every FAB click then
  // hit the "still checking" branch and was silently swallowed ("no
  // reaction"). If loading somehow exceeds AUTH_LOADING_DEADMAN_MS we stop
  // waiting and treat the visitor as logged out instead of eating clicks.
  const authLoadingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (authLoading) {
      if (authLoadingSinceRef.current === null) authLoadingSinceRef.current = Date.now();
    } else {
      authLoadingSinceRef.current = null;
    }
  }, [authLoading]);

  const handleFabClick = useCallback(() => {
    // While auth state is loading, show a toast and wait — don't silently ignore the click.
    if (authLoading) {
      const waitedMs = authLoadingSinceRef.current ? Date.now() - authLoadingSinceRef.current : 0;
      if (waitedMs < AUTH_LOADING_DEADMAN_MS) {
        const loadingMsg = lang === "ar"
          ? "جارٍ التحقق من تسجيل الدخول..."
          : "Checking login status...";
        toast(loadingMsg, { duration: 1500 });
        return;
      }
      // Auth check stuck — fall through and treat as logged out.
    }
    // Auth gate: redirect to login if not authenticated
    if (!isAuthenticated) {
      const redirectMsg = lang === "ar"
        ? "يجب تسجيل الدخول أولاً لاستخدام المساعد الذكي"
        : "Please log in to use the AI assistant";
      toast(redirectMsg, { duration: 2500 });
      navigate("/login");
      return;
    }
    setIsOpen(true);
    setIsMinimized(false);
  }, [authLoading, isAuthenticated, navigate, lang]);

  // ─── Retry handler that actually re-sends ───
  const handleRetry = useCallback((failedMsgId: string) => {
    // Remove error message and find the last user message to re-send
    setMessages((prev) => {
      const withoutError = prev.filter((m) => m.id !== failedMsgId);
      // Find last user message
      let lastUserMsg: Message | null = null;
      let lastUserIdx = -1;
      for (let i = withoutError.length - 1; i >= 0; i--) {
        if (withoutError[i].role === "user") {
          lastUserMsg = withoutError[i];
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserMsg && lastUserIdx >= 0) {
        // Remove user message from list (sendMessage will re-add it)
        const filtered = withoutError.filter((m) => m.id !== lastUserMsg!.id);
        // Trigger send after state update
        setTimeout(() => {
          sendMessage(lastUserMsg!.content);
        }, 100);
        return filtered;
      }
      return withoutError;
    });
  }, [sendMessage]);

  // ─── Unread count (assistant messages received while chat was closed) ───
  const [lastSeenCount, setLastSeenCount] = useState(messages.length);
  useEffect(() => {
    if (isOpen) {
      setLastSeenCount(messages.length); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [isOpen, messages.length]);

  const innerSeenCount = lastSeenCount > 0
    ? messages.slice(0, lastSeenCount).filter((m) => m.role === "assistant" && !m.isError).length
    : 0;
  const unreadCount = isOpen ? 0 : Math.max(0, messages.filter((m) => m.role === "assistant" && !m.isError).length -
        innerSeenCount);

  // ─── Streaming model display ───
  const streamingModelName = activeModel ? getShortModelName(activeModel) : "";
  const thinkingWithModel = `${(lang === "ar" ? "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u0641\u0643\u064a\u0631 \u0628\u0640 " : "Thinking with ") + streamingModelName}...`;
  const thinkingWithoutModel = lang === "ar" ? "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u0641\u0643\u064a\u0631..." : "Thinking...";

  return (
    <>
      {/* ─── Floating Button ─── */}
      {!isOpen && (
        <button
          ref={fabRef}
          onClick={handleFabClick}
          className={"fixed z-[100] w-10 h-10 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-cyan-500/40 active:scale-95 chatbot-fab transform-gpu will-change-transform" +
            (fabHidden ? " fab-scroll-hidden" : "")}
          aria-label={lang === "ar" ? "\u0641\u062a\u062d \u0627\u0644\u0645\u0633\u0627\u0639\u062f \u0627\u0644\u0630\u0643\u064a" : "Open AI Assistant"}
        >
          <div className="relative">
            <Bot className="w-5 h-5 md:w-6 md:h-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          {/* Pulse ring — only when there are unread messages: a constant
              ping next to the WhatsApp pulse was visual noise (declutter). */}
          {unreadCount > 0 && (
            <span className="absolute inset-0 rounded-full bg-cyan-400/30 animate-ping" />
          )}
        </button>
      )}

      {/* ─── Chat Window ─── */}
      {isOpen && (
        <div
          className={"fixed z-[100] transition-all duration-300 ease-out chatbot-window " +
            (isMinimized
              ? "chatbot-min w-10 h-10 md:w-14 md:h-14 rounded-full"
              : "w-[calc(100vw-2rem)] md:w-[420px] h-[calc(100dvh-8rem)] md:h-[600px] rounded-2xl"
            )}
          style={(() => {
            if (isMinimized) return undefined;
            if (kb.open && kb.small && kb.height > 0) {
              // Keyboard is open on a phone — pin the window just above the
              // keyboard and use the full visual viewport height (works on
              // both iOS Safari and Android Chrome). transition:none keeps
              // the window glued to the keyboard during its slide animation.
              return {
                bottom: `${(kb.offsetBottom > 0 ? kb.offsetBottom : 0) + 8}px`,
                height: `${kb.height - 16}px`,
                right: '1rem',
                maxWidth: '420px',
                transition: 'none',
              };
            }
            return { bottom: 'max(env(safe-area-inset-bottom, 0px) + 1rem, 1rem)', right: '1rem', maxWidth: '420px' };
          })()}
        >
          <div
            className={"relative h-full flex flex-col overflow-hidden " +
              (isMinimized
                ? "bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full cursor-pointer"
                : "bg-[#0a1019] border border-[#1e2d3d] rounded-2xl shadow-2xl shadow-black/50"
              )}
          >
            {/* ─── Minimized: Just the button ─── */}
            {isMinimized && (
              <button
                onClick={() => setIsMinimized(false)}
                className="w-full h-full flex items-center justify-center text-white"
                aria-label={lang === "ar" ? "\u0641\u062a\u062d \u0627\u0644\u0634\u0627\u062a" : "Open chat"}
              >
                <Bot className="w-5 h-5 md:w-6 md:h-6" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0a1019]" />
              </button>
            )}

            {/* ─── Expanded Chat UI ─── */}
            {!isMinimized && (
              <>
                {/* ─── Header ─── */}
                <div className="flex-shrink-0 px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border-b border-[#1e2d3d]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                          <Zap className="w-5 h-5 text-white" />
                        </div>
                        <span className="absolute -bottom-0.5 -end-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0a1019]" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {lang === "ar" ? "\u0628\u0648\u062a \u0627\u0644\u0628\u0627\u0632 \u0627\u0644\u0630\u0643\u064a" : "Elbaz AI Bot"}
                        </h3>
                        <p className="text-[11px] text-cyan-400/70">
                          {lang === "ar"
                            ? "\u0645\u0633\u0627\u0639\u062f \u0627\u0644\u0647\u0646\u062f\u0633\u0629 \u0627\u0644\u0643\u0647\u0631\u0628\u064a\u0629"
                            : "Electrical Engineering Assistant"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Clear chat button */}
                      <button
                        onClick={clearChat}
                        className="p-2.5 rounded-lg text-slate-400 hover:text-red-400 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-red-400/10 transition-colors"
                        title={lang === "ar" ? "\u0645\u0633\u062d \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629" : "Clear chat"}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {/* Minimize button */}
                      <button
                        onClick={() => setIsMinimized(true)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
                        title={lang === "ar" ? "\u062a\u0635\u063a\u064a\u0631" : "Minimize"}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {/* Close button */}
                      <button
                        onClick={() => setIsOpen(false)}
                        className="p-2.5 rounded-lg text-slate-400 hover:text-red-400 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-red-400/10 transition-colors"
                        title={lang === "ar" ? "\u0625\u063a\u0644\u0627\u0642" : "Close"}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ─── Mode Selector (Thinking / Instant) ─── */}
                <div className="flex-shrink-0 px-3 py-2 bg-[#0d1620] border-b border-[#1e2d3d]">
                  <div className="flex items-center gap-1.5 p-1 bg-[#0a1019] rounded-lg border border-[#1e2d3d]">
                    {/* Thinking Mode Button */}
                    <button
                      onClick={() => toggleChatMode("thinking")}
                      disabled={isLoading}
                      className={
                        "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed " +
                        (chatMode === "thinking"
                          ? "bg-gradient-to-r from-violet-500/30 to-indigo-500/30 text-violet-300 border border-violet-500/40 shadow-sm"
                          : "text-slate-500 hover:text-slate-300 border border-transparent")
                      }
                      title={lang === "ar"
                        ? "وضع التفكير: أعمق تحليل وأعلى دقة — مثالي للحسابات والأسئلة المعقدة (أبطأ قليلاً)"
                        : "Thinking mode: deeper analysis & higher accuracy — ideal for complex calculations (slower)"}
                    >
                      <Brain className="w-3.5 h-3.5" />
                      <span>{lang === "ar" ? "\u062a\u0641\u0643\u064a\u0631" : "Thinking"}</span>
                    </button>

                    {/* Instant Mode Button */}
                    <button
                      onClick={() => toggleChatMode("instant")}
                      disabled={isLoading}
                      className={
                        "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed " +
                        (chatMode === "instant"
                          ? "bg-gradient-to-r from-cyan-500/30 to-blue-500/30 text-cyan-300 border border-cyan-500/40 shadow-sm"
                          : "text-slate-500 hover:text-slate-300 border border-transparent")
                      }
                      title={lang === "ar"
                        ? "وضع السرعة: أسرع رد وإجابات مختصرة للأسئلة المباشرة"
                        : "Instant mode: fastest replies, concise answers for direct questions"}
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      <span>{lang === "ar" ? "\u0633\u0631\u064a\u0639" : "Instant"}</span>
                    </button>
                  </div>
                  {/* Mode description */}
                  {(() => {
                    const thinkingDesc = lang === "ar"
                      ? "أعمق نموذج + تحليل هندسي دقيق ومُتحقق منه — للمسائل والحسابات المعقدة"
                      : "Strongest model + verified deep engineering analysis — for complex problems";
                    const instantDesc = lang === "ar"
                      ? "أسرع نموذج + ردود مختصرة فورية — للأسئلة السريعة"
                      : "Fastest model + instant concise replies — for quick questions";
                    const modeDesc = chatMode === "thinking" ? thinkingDesc : instantDesc;
                    return (
                      <p className={`text-[10px] text-slate-600 mt-1.5 text-center ${kb.open ? "hidden" : ""}`}>
                        {modeDesc}
                      </p>
                    );
                  })()}
                </div>

                {/* ─── Messages Area ─── */}
                <div ref={chatContainerRef} onScroll={handleMessagesScroll} role="log" aria-label={lang === "ar" ? "\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629" : "Chat messages"} aria-live="polite" className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4 chatbot-messages">
                  {messages.map((msg) => {
                    const errorBubbleClass = msg.isError
                      ? "bg-red-500/10 border border-red-500/30 text-red-300 rounded-ss-md"
                      : "bg-[#111827] border border-[#1e2d3d] text-[#e8f0fe] rounded-ss-md";
                    const bubbleClass = msg.role === "user"
                      ? "bg-gradient-to-br from-cyan-600 to-blue-600 text-white rounded-ee-md"
                      : errorBubbleClass;
                    return (
                    <div
                      key={msg.id}
                      className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {/* Avatar */}
                      <div
                        className={"flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5 " +
                          (msg.role === "user"
                            ? "bg-blue-600/20 border border-blue-500/30"
                            : "bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30")
                        }
                      >
                        {msg.role === "user" ? (
                          <User className="w-3.5 h-3.5 text-blue-400" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                      </div>

                      {/* Message Bubble */}
                      <div className="flex flex-col max-w-[85%] min-w-0">
                        <div
                          dir={ARABIC_RE.test(msg.content) ? "rtl" : "ltr"}
                          className={"relative group px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed break-words overflow-wrap-anywhere whitespace-pre-wrap word-break-break-word " +
                            bubbleClass
                          }
                        >
                          {msg.role === "assistant" && msg.isError ? (
                            <span className="whitespace-pre-wrap">{msg.content}</span>
                          ) : (
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown() escapes all HTML entities first, only re-adds safe markdown formatting tags
                            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                          )}

                          {/* Copy button (assistant messages, only on hover) */}
                          {msg.role === "assistant" && !msg.isError && msg.id !== "welcome" && (
                            <button
                              onClick={() => copyMessage(msg.id, msg.content)}
                              className="absolute top-1.5 end-1.5 p-1 rounded-md opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-slate-500 hover:text-cyan-400 hover:bg-white/5"
                              title={lang === "ar" ? "\u0646\u0633\u062e" : "Copy"}
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          )}

                          {/* Copied tooltip */}
                          {copiedId === msg.id && (
                            <span className="absolute top-1.5 end-8 text-[10px] text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20">
                              {lang === "ar" ? "\u062a\u0645 \u0627\u0644\u0646\u0633\u062e!" : "Copied!"}
                            </span>
                          )}
                        </div>

                        {/* Model name label */}
                        {msg.role === "assistant" && !msg.isError && msg.model && (
                          <span className="text-[10px] text-slate-600 mt-1 ms-1">
                            {getShortModelName(msg.model)}
                          </span>
                        )}

                        {/* Retry button (error messages) */}
                        {msg.isError && (
                          <button
                            onClick={() => handleRetry(msg.id)}
                            className="flex items-center gap-1.5 mt-2 ms-1 text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {lang === "ar" ? "\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629" : "Retry"}
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}

                  {/* Streaming content (incremental text display) */}
                  {isLoading && streamingContent && (
                    <div className="flex gap-2.5">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                      <div className="flex flex-col max-w-[85%] min-w-0">
                        <div dir={ARABIC_RE.test(streamingContent) ? "rtl" : "ltr"} className="px-3.5 py-2.5 rounded-2xl rounded-ss-md bg-[#111827] border border-[#1e2d3d] text-[#e8f0fe] text-[13.5px] leading-relaxed break-words overflow-wrap-anywhere whitespace-pre-wrap word-break-break-word">
                          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown() escapes all HTML entities first; only safe markdown tags are re-added */}
                          <span key={chunkIndex} className="animate-stream-fade" dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }} />
                          {/* Blinking caret */}
                          <span className="inline-block w-[2px] h-[1.1em] ms-0.5 bg-cyan-400/90 rounded-sm animate-typing-cursor align-text-bottom shadow-[0_0_6px_rgba(6,182,212,0.5)]" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Typing indicator (with enter/exit animations) */}
                  {typingVisible && (
                    <div className={`flex gap-2.5 ${typingExiting ? "animate-typing-exit" : "animate-typing-enter"}`}>
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                      <div className="bg-[#111827] border border-[#1e2d3d] px-4 py-3 rounded-2xl rounded-ss-md">
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          <span className="text-[11px] text-slate-500 ms-1">
                            {streamingModelName ? thinkingWithModel : thinkingWithoutModel}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* ─── Jump to latest (appears when the user scrolled up mid-stream) ─── */}
                {showJumpToLatest && (
                  <button
                    onClick={() => scrollToBottom(true)}
                    className="absolute bottom-[110px] left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-3 py-1.5 rounded-full bg-cyan-500/90 text-white text-[11px] font-medium shadow-lg shadow-cyan-500/30 active:scale-95 transition-transform"
                    aria-label={lang === "ar" ? "\u0627\u0644\u0627\u0646\u062a\u0642\u0627\u0644 \u0644\u0623\u062d\u062f\u062b \u0631\u0633\u0627\u0644\u0629" : "Jump to latest message"}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    {lang === "ar" ? "\u0623\u062d\u062f\u062b \u0631\u0633\u0627\u0644\u0629" : "Latest"}
                  </button>
                )}

                {/* ─── Quick Suggestions (show only on first open) ─── */}
                {messages.length <= 1 && !isLoading && (
                  <div className="flex-shrink-0 px-4 pb-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(lang === "ar"
                        ? [
                            "\u0627\u064a\u0647 \u0641\u0627\u064a\u062f\u0629 ETAP\u061f",
                            "\u0643\u064a\u0641 \u0623\u0639\u0645\u0644 load flow analysis\u061f",
                            "\u0627\u0644\u0641\u0631\u0642 \u0628\u064a\u0646 SKM \u0648 PowerFactory",
                            "\u0627\u064a\u0647 \u0647\u0648 arc flash study\u061f",
                          ]
                        : [
                            "What is ETAP used for?",
                            "How to do load flow analysis?",
                            "SKM vs PowerFactory comparison",
                            "What is an arc flash study?",
                          ]
                      ).map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => {
                              setInput(suggestion);
                              setTimeout(() => { inputRef.current?.focus(); }, 50);
                            }}
                            className="px-2.5 py-1.5 text-[11px] text-cyan-400/80 bg-cyan-400/5 border border-cyan-400/10 rounded-lg hover:bg-cyan-400/10 hover:border-cyan-400/20 transition-colors truncate max-w-[180px]"
                          >
                            {suggestion}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* ─── Input Area ─── */}
                <div className="flex-shrink-0 px-3 py-3 border-t border-[#1e2d3d] bg-[#0a1019]">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 relative">
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder={
                          lang === "ar"
                            ? "\u0627\u0633\u0623\u0644 \u0633\u0624\u0627\u0644\u0643 \u0627\u0644\u0647\u0646\u062f\u0633\u064a..."
                            : "Ask your engineering question..."
                        }
                        rows={1}
                        disabled={isLoading}
                        dir={ARABIC_RE.test(input) ? "rtl" : "ltr"}
                        aria-label={lang === "ar" ? "\u0627\u0643\u062a\u0628 \u0631\u0633\u0627\u0644\u062a\u0643" : "Type your message"}
                        className="w-full px-3.5 py-2.5 bg-[#111827] border border-[#1e2d3d] rounded-xl text-[13.5px] text-[#e8f0fe] placeholder:text-slate-500 resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all disabled:opacity-50"
                        style={{ minHeight: "40px", maxHeight: "120px" }}
                      />
                    </div>
                    <button
                      onClick={() => sendMessage()}
                      disabled={!input.trim() || isLoading}
                      className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center transition-all hover:shadow-lg hover:shadow-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none active:scale-95"
                      aria-label={lang === "ar" ? "\u0625\u0631\u0633\u0627\u0644" : "Send"}
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className={`text-center text-[10px] text-slate-600 mt-2 ${kb.open ? "hidden" : ""}`}>
                    {lang === "ar"
                      ? "\u0628\u0648\u062a \u0627\u0644\u0628\u0627\u0632 \u0627\u0644\u0630\u0643\u064a \u2014 \u0645\u062a\u062e\u0635\u0635 \u0641\u064a \u0627\u0644\u0647\u0646\u062f\u0633\u0629 \u0627\u0644\u0643\u0647\u0631\u0628\u064a\u0629 \u0641\u0642\u0637"
                      : "Elbaz AI Bot \u2014 Electrical Engineering Specialist Only"}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
