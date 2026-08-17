import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { useChatFabAnimation } from "@/hooks/useChatFabAnimation";
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

// ─── Markdown to HTML (simple regex-based, no library) ───────────────────────

function renderMarkdown(text: string): string {
  // Escape HTML entities first (preserve markdown markers)
  let html = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#x27;");

  // Code blocks (``` ... ```). The lazy `([\s\S]+?)` quantifier requires at
  // least one character of code and is bounded by the closing ```, so it
  // cannot backtrack super-linearly.
  // S8786: regex is intentionally bounded; `[\s\S]+?` is the canonical
  // non-backtracking pattern for delimited multiline captures.
  html = html.replaceAll(/```(\w*)\n?([\s\S]+?)```/g, (_match, _lang, code) => `<pre class="bg-black/40 border border-[#1e2d3d] rounded-lg p-2.5 my-1.5 overflow-x-auto text-[12px] leading-5 text-[#b4c6e0]"><code>${code.trim()}</code></pre>`); // NOSONAR — S8786: regex is intentionally bounded

  // Inline code (` ... `)
  html = html.replaceAll(/`([^`]+)`/g, '<code class="bg-black/30 border border-[#1e2d3d] px-1.5 py-0.5 rounded text-[12px] text-cyan-300">$1</code>');

  // Bold (** ... **)
  html = html.replaceAll(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');

  // Italic (* ... *)
  html = html.replaceAll(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Line breaks: double newline → paragraph break, single newline → <br>
  html = html.replaceAll('\n\n', "<br><br>");
  html = html.replaceAll('\n', "<br>");

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
  const fabRef = useChatFabAnimation();
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingExitStartedRef = useRef(false);

  // ─── Typing indicator visibility (handles enter/exit animations) ───
  const [typingVisible, setTypingVisible] = useState(false);
  const [typingExiting, setTypingExiting] = useState(false);

  // ─── Auto-scroll during streaming (instant scroll, responsive) ───
  useEffect(() => {
    if (chatContainerRef.current && streamingContent) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [streamingContent]);

  // ─── Smooth auto-scroll when new messages arrive ───
  useEffect(() => {
    if (messagesEndRef.current && !isLoading) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [isLoading]);

  // ─── Focus input when chat opens ───
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
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
      language: lang,
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
            if (abortControllerRef.current?.signal.aborted) break;
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

          const botMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: fullReply,
            timestamp: new Date(),
            model: data.model || undefined,
          };
          setMessages((prev) => [...prev, botMsg]);
        } else {
          addErrorMessage(
            lang === "ar"
              ? "يبدو أن هناك ضغط على الشبكة، حاول إرسال رسالتك مرة أخرى ⚡"
              : "The network seems busy. Please try sending your message again ⚡"
          );
        }
      }
    } catch (error) {
      console.warn("ChatBot send failed:", error);
      addErrorMessage(
        lang === "ar"
          ? "يبدو أن هناك ضغط على الشبكة، حاول إرسال رسالتك مرة أخرى ⚡"
          : "The network seems busy. Please try sending your message again ⚡"
      );
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
  const clearChat = () => {
    chatIdRef.current = crypto.randomUUID();
    setMessages([WELCOME_MESSAGES[lang]]);
    setStreamingContent("");
    setActiveModel("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Intentionally ignored: clearChat must proceed even if localStorage is unavailable. — SonarCloud S2486 */ }
  };

  // ─── Toggle chat mode (Thinking/Instant) ───
  const toggleChatMode = useCallback((mode: ChatMode) => {
    setChatMode(mode);
    saveChatMode(mode);
  }, []);

  // ─── Handle FAB click: auth gate ───
  const handleFabClick = useCallback(() => {
    // While auth state is loading, show a toast and wait — don't silently ignore the click
    if (authLoading) {
      const loadingMsg = lang === "ar"
        ? "جارٍ التحقق من تسجيل الدخول..."
        : "Checking login status...";
      toast(loadingMsg, { duration: 1500 });
      return;
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
          className="fixed right-4 md:right-6 z-[100] w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-cyan-500/40 active:scale-95 chatbot-fab transform-gpu will-change-transform"
          style={{ bottom: 'max(env(safe-area-inset-bottom, 0px) + 5rem, 5rem)' }}
          aria-label={lang === "ar" ? "\u0641\u062a\u062d \u0627\u0644\u0645\u0633\u0627\u0639\u062f \u0627\u0644\u0630\u0643\u064a" : "Open AI Assistant"}
        >
          <div className="relative">
            <Bot className="w-6 h-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          {/* Pulse ring */}
          <span className="absolute inset-0 rounded-full bg-cyan-400/30 animate-ping" />
        </button>
      )}

      {/* ─── Chat Window ─── */}
      {isOpen && (
        <div
          className={"fixed z-[100] transition-all duration-300 ease-out chatbot-window " +
            (isMinimized
              ? "w-14 h-14 rounded-full"
              : "w-[calc(100vw-2rem)] md:w-[420px] h-[calc(100vh-8rem)] md:h-[600px] rounded-2xl"
            )}
          style={isMinimized
            ? { bottom: 'max(env(safe-area-inset-bottom, 0px) + 4.5rem, 4.5rem)', right: '1rem' }
            : { bottom: 'max(env(safe-area-inset-bottom, 0px) + 1rem, 1rem)', right: '1rem', maxWidth: '420px' }
          }
        >
          <div
            className={"h-full flex flex-col overflow-hidden " +
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
                <Bot className="w-6 h-6" />
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
                        ? "\u0648\u0636\u0639 \u0627\u0644\u062a\u0641\u0643\u064a\u0631: \u0646\u0645\u0648\u0630\u062c GLM 5.1 (\u0623\u0641\u0636\u0644 \u062c\u0648\u062f\u0629\u060c \u0623\u0637\u0648\u0644 \u0648\u0642\u062a \u0627\u0633\u062a\u062c\u0627\u0628\u0629)"
                        : "Thinking mode: GLM 5.1 model (best quality, longer response time)"}
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
                        ? "\u0648\u0636\u0639 \u0627\u0644\u0633\u0631\u0639\u0629: \u0646\u0645\u0627\u0630\u062c OpenRouter \u0648 Groq (\u0623\u0633\u0631\u0639 \u0627\u0633\u062a\u062c\u0627\u0628\u0629)"
                        : "Instant mode: OpenRouter & Groq models (fastest response)"}
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      <span>{lang === "ar" ? "\u0633\u0631\u064a\u0639" : "Instant"}</span>
                    </button>
                  </div>
                  {/* Mode description */}
                  {(() => {
                    const thinkingDesc = lang === "ar"
                      ? "نموذج GLM 5.1 — تحليل عميق وأسئلة معقدة"
                      : "GLM 5.1 model — deep reasoning for complex questions";
                    const instantDesc = lang === "ar"
                      ? "نماذج Groq — ردود سريعة للأسئلة البسيطة"
                      : "Groq models — fast responses for simple questions";
                    const modeDesc = chatMode === "thinking" ? thinkingDesc : instantDesc;
                    return (
                      <p className="text-[10px] text-slate-600 mt-1.5 text-center">
                        {modeDesc}
                      </p>
                    );
                  })()}
                </div>

                {/* ─── Messages Area ─── */}
                <div ref={chatContainerRef} role="log" aria-label={lang === "ar" ? "\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629" : "Chat messages"} aria-live="polite" className="flex-1 overflow-y-auto px-4 py-3 space-y-4 chatbot-messages">
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
                        <div className="px-3.5 py-2.5 rounded-2xl rounded-ss-md bg-[#111827] border border-[#1e2d3d] text-[#e8f0fe] text-[13.5px] leading-relaxed break-words overflow-wrap-anywhere whitespace-pre-wrap word-break-break-word">
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
                  <p className="text-center text-[10px] text-slate-600 mt-2">
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
