import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
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

// ─── Markdown to HTML (simple regex-based, no library) ───────────────────────

function renderMarkdown(text: string): string {
  // Escape HTML entities first (but preserve our markdown markers)
  var html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_match, _lang, code) {
    return '<pre class="bg-black/40 border border-[#1e2d3d] rounded-lg p-2.5 my-1.5 overflow-x-auto text-[12px] leading-5 text-[#b4c6e0]"><code>' + code.trim() + '</code></pre>';
  });

  // Inline code (` ... `)
  html = html.replace(/`([^`]+)`/g, '<code class="bg-black/30 border border-[#1e2d3d] px-1.5 py-0.5 rounded text-[12px] text-cyan-300">$1</code>');

  // Bold (** ... **)
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong class=\"font-semibold text-white\">$1</strong>");

  // Italic (* ... *)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Line breaks: double newline → paragraph break, single newline → <br>
  html = html.replace(/\n\n/g, "<br><br>");
  html = html.replace(/\n/g, "<br>");

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

export default function ChatBot() {
  const { t, lang } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGES[lang]]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("");
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string>(crypto.randomUUID());
  const abortControllerRef = useRef<AbortController | null>(null);
  const fabRef = useChatFabAnimation();

  // ─── Scroll to bottom when new messages arrive ───
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);

  // ─── Focus input when chat opens ───
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, isMinimized]);

  // ─── Clear copied tooltip after 2s ───
  useEffect(() => {
    if (copiedId) {
      var timer = setTimeout(() => setCopiedId(""), 2000);
      return () => clearTimeout(timer);
    }
  }, [copiedId]);

  // ─── Extract short model name ───
  const getShortModelName = useCallback((modelId: string): string => {
    if (!modelId) return "";
    var parts = modelId.split("/");
    var name = parts.length > 1 ? parts[1] : modelId;
    return name.replace(/:free$/, "").replace(/:.*$/, "");
  }, []);

  // ─── Copy message to clipboard ───
  const copyMessage = useCallback((msgId: string, content: string) => {
    navigator.clipboard.writeText(content).then(function() {
      setCopiedId(msgId);
    }).catch(function() {
      // Fallback: use textarea trick
      var ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedId(msgId);
    });
  }, []);

  // ─── Send message (with streaming) ───
  const sendMessage = useCallback(async (overrideInput?: string) => {
    var trimmed = (overrideInput || input).trim();
    if (!trimmed || isLoading) return;

    var userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    // Update messages state
    setMessages(function(prev) { return [...prev.slice(-MAX_HISTORY), userMessage]; });
    setInput("");
    setIsLoading(true);
    setStreamingContent("");
    setActiveModel("");

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Build API messages
    var apiMessages = [...messages.slice(-20), userMessage]
      .filter(function(m) { return m.id !== "welcome"; })
      .map(function(m) {
        return { role: m.role as "user" | "assistant", content: m.content };
      });

    var requestBody = {
      messages: apiMessages,
      language: lang,
      chatId: chatIdRef.current,
    };

    // Create abort controller
    abortControllerRef.current = new AbortController();

    var addErrorMessage = function(errText: string) {
      var errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: errText,
        timestamp: new Date(),
        isError: true,
      };
      setMessages(function(prev) { return [...prev, errorMessage]; });
    };

    try {
      // ─── Try streaming endpoint first ───
      var streamSuccess = false;
      try {
        var streamResponse = await fetch((window.Capacitor?.isNativePlatform() ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io") : "") + "/api/chatbot/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });

        if (streamResponse.ok) {
          var reader = streamResponse.body?.getReader();
          if (reader) {
            var decoder = new TextDecoder();
            var accumulated = "";
            var buffer = "";
            var streamError: string | null = null;
            var receivedModel = "";

            while (true) {
              var result = await reader.read();
              if (result.done) break;

              buffer += decoder.decode(result.value, { stream: true });
              // Parse SSE lines
              var lines = buffer.split("\n");
              buffer = lines.pop() || ""; // Keep incomplete line in buffer

              for (var li = 0; li < lines.length; li++) {
                var line = lines[li].trim();
                if (!line.startsWith("data: ")) continue;
                var payload = line.slice(6).trim();

                if (payload === "[DONE]") {
                  continue;
                }

                try {
                  var parsed = JSON.parse(payload);
                  if (parsed.model) {
                    receivedModel = parsed.model;
                    setActiveModel(parsed.model);
                  } else if (parsed.text) {
                    accumulated += parsed.text;
                    setStreamingContent(accumulated);
                  } else if (parsed.error) {
                    streamError = parsed.error;
                  }
                } catch (_e) {
                  // Treat as raw text chunk
                  accumulated += payload;
                  setStreamingContent(accumulated);
                }
              }
            }

            // Process remaining buffer
            if (buffer.trim()) {
              var remainingLine = buffer.trim();
              if (remainingLine.startsWith("data: ")) {
                var remainingPayload = remainingLine.slice(6).trim();
                if (remainingPayload !== "[DONE]") {
                  try {
                    var rParsed = JSON.parse(remainingPayload);
                    if (rParsed.text) accumulated += rParsed.text;
                  } catch (_e2) {
                    accumulated += remainingPayload;
                  }
                }
              }
            }

            if (streamError) {
              addErrorMessage(
                lang === "ar"
                  ? "\u0639\u0630\u0631\u0627\u064b\u060c \u062d\u062f\u062b \u062e\u0637\u0623. \u064a\u0631\u062c\u0649 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0644\u0627\u062d\u0642\u0627\u064b."
                  : "An error occurred. Please try again."
              );
            } else if (accumulated.trim()) {
              var botMessage: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: accumulated.trim(),
                timestamp: new Date(),
                model: receivedModel || undefined,
              };
              setMessages(function(prev) { return [...prev, botMessage]; });
            } else {
              addErrorMessage(
                lang === "ar"
                  ? "\u0639\u0630\u0631\u0627\u064b\u060c \u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u062d\u0635\u0648\u0644 \u0639\u0644\u0649 \u0631\u062f. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649."
                  : "No response received. Please try again."
              );
            }
            streamSuccess = true;
          }
        }
      } catch (_streamErr) {
        // Streaming failed, fall through to regular endpoint
        streamSuccess = false;
      }

      // ─── Fallback: regular /api/chatbot ───
      if (!streamSuccess) {
        setStreamingContent("");
        var response = await fetch((window.Capacitor?.isNativePlatform() ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io") : "") + "/api/chatbot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current?.signal,
        });

        var data = await response.json();

        if (data.success && data.reply) {
          if (data.model) setActiveModel(data.model);
          var botMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.reply,
            timestamp: new Date(),
            model: data.model || undefined,
          };
          setMessages(function(prev) { return [...prev, botMsg]; });
        } else {
          addErrorMessage(
            lang === "ar"
              ? "\u0639\u0630\u0631\u0627\u064b\u060c \u062d\u062f\u062b \u062e\u0637\u0623. \u064a\u0631\u062c\u0649 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0644\u0627\u062d\u0642\u0627\u064b."
              : "An error occurred. Please try again."
          );
        }
      }
    } catch (_err) {
      addErrorMessage(
        lang === "ar"
          ? "\u062a\u0639\u0630\u0631 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u062e\u0627\u062f\u0645. \u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u062a\u0635\u0627\u0644\u0643 \u0628\u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a \u0648\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649."
          : "Could not connect to the service. Check your internet connection and try again."
      );
    } finally {
      setIsLoading(false);
      setStreamingContent("");
      abortControllerRef.current = null;
    }
  }, [input, isLoading, messages, lang]);

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
    var textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  };

  // ─── Clear chat ───
  const clearChat = () => {
    chatIdRef.current = crypto.randomUUID();
    setMessages([WELCOME_MESSAGES[lang]]);
    setStreamingContent("");
    setActiveModel("");
  };

  // ─── Retry handler that actually re-sends ───
  const handleRetry = useCallback((failedMsgId: string) => {
    // Remove error message and find the last user message to re-send
    setMessages(function(prev) {
      var withoutError = prev.filter(function(m) { return m.id !== failedMsgId; });
      // Find last user message
      var lastUserMsg: Message | null = null;
      var lastUserIdx = -1;
      for (var i = withoutError.length - 1; i >= 0; i--) {
        if (withoutError[i].role === "user") {
          lastUserMsg = withoutError[i];
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserMsg && lastUserIdx >= 0) {
        // Remove user message from list (sendMessage will re-add it)
        var filtered = withoutError.filter(function(m) { return m.id !== lastUserMsg!.id; });
        // Trigger send after state update
        setTimeout(function() {
          sendMessage(lastUserMsg!.content);
        }, 100);
        return filtered;
      }
      return withoutError;
    });
  }, [sendMessage]);

  // ─── Unread count (when closed) ───
  var unreadCount = !isOpen
    ? messages.filter(function(m, i) { return i > 0 && m.role === "assistant" && !m.isError; }).length -
      (messages.length > 0 ? 0 : 0)
    : 0;

  // ─── Streaming model display ───
  var streamingModelName = activeModel ? getShortModelName(activeModel) : "";

  return (
    <>
      {/* ─── Floating Button ─── */}
      {!isOpen && (
        <button
          ref={fabRef}
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-cyan-500/40 active:scale-95 chatbot-fab"
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
          className={"fixed z-50 transition-all duration-300 ease-out chatbot-window " +
            (isMinimized
              ? "bottom-24 md:bottom-8 right-4 md:right-8 w-14 h-14 rounded-full"
              : "bottom-4 right-4 md:right-8 w-[calc(100vw-2rem)] md:w-[420px] h-[calc(100vh-8rem)] md:h-[600px] rounded-2xl"
            )}
          style={{ maxWidth: isMinimized ? undefined : "420px" }}
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
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0a1019]" />
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

                {/* ─── Messages Area ─── */}
                <div role="log" aria-label={lang === "ar" ? "\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629" : "Chat messages"} aria-live="polite" className="flex-1 overflow-y-auto px-4 py-3 space-y-4 chatbot-messages">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={"flex gap-2.5 " + (msg.role === "user" ? "flex-row-reverse" : "flex-row")}
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
                      <div className="flex flex-col max-w-[80%]">
                        <div
                          className={"relative group px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed " +
                            (msg.role === "user"
                              ? "bg-gradient-to-br from-cyan-600 to-blue-600 text-white rounded-tr-md"
                              : msg.isError
                                ? "bg-red-500/10 border border-red-500/30 text-red-300 rounded-tl-md"
                                : "bg-[#111827] border border-[#1e2d3d] text-[#e8f0fe] rounded-tl-md"
                            )
                          }
                        >
                          {msg.role === "assistant" && !msg.isError ? (
                            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                          ) : (
                            <span className="whitespace-pre-wrap">{msg.content}</span>
                          )}

                          {/* Copy button (assistant messages, only on hover) */}
                          {msg.role === "assistant" && !msg.isError && msg.id !== "welcome" && (
                            <button
                              onClick={() => copyMessage(msg.id, msg.content)}
                              className="absolute top-1.5 right-1.5 p-1 rounded-md opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-slate-500 hover:text-cyan-400 hover:bg-white/5"
                              title={lang === "ar" ? "\u0646\u0633\u062e" : "Copy"}
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          )}

                          {/* Copied tooltip */}
                          {copiedId === msg.id && (
                            <span className="absolute top-1.5 right-8 text-[10px] text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20">
                              {lang === "ar" ? "\u062a\u0645 \u0627\u0644\u0646\u0633\u062e!" : "Copied!"}
                            </span>
                          )}
                        </div>

                        {/* Model name label */}
                        {msg.role === "assistant" && !msg.isError && msg.model && (
                          <span className="text-[10px] text-slate-600 mt-1 ml-1">
                            {getShortModelName(msg.model)}
                          </span>
                        )}

                        {/* Retry button (error messages) */}
                        {msg.isError && (
                          <button
                            onClick={() => handleRetry(msg.id)}
                            className="flex items-center gap-1.5 mt-2 ml-1 text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {lang === "ar" ? "\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629" : "Retry"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Streaming content (incremental text display) */}
                  {isLoading && streamingContent && (
                    <div className="flex gap-2.5">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                      <div className="flex flex-col max-w-[80%]">
                        <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-[#111827] border border-[#1e2d3d] text-[#e8f0fe] text-[13.5px] leading-relaxed">
                          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }} />
                          {/* Blinking caret */}
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-cyan-400 animate-pulse align-text-bottom" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Typing indicator (only show when NOT streaming content yet) */}
                  {isLoading && !streamingContent && (
                    <div className="flex gap-2.5">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                      <div className="bg-[#111827] border border-[#1e2d3d] px-4 py-3 rounded-2xl rounded-tl-md">
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          <span className="text-[11px] text-slate-500 ml-1">
                            {streamingModelName
                              ? (lang === "ar" ? "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u0641\u0643\u064a\u0631 \u0628\u0640 " : "Thinking with ") + streamingModelName + "..."
                              : (lang === "ar" ? "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u0641\u0643\u064a\u0631..." : "Thinking...")}
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
                      ).map(function(suggestion) {
                        return (
                          <button
                            key={suggestion}
                            onClick={() => {
                              setInput(suggestion);
                              setTimeout(function() { inputRef.current?.focus(); }, 50);
                            }}
                            className="px-2.5 py-1.5 text-[11px] text-cyan-400/80 bg-cyan-400/5 border border-cyan-400/10 rounded-lg hover:bg-cyan-400/10 hover:border-cyan-400/20 transition-colors truncate max-w-[180px]"
                          >
                            {suggestion}
                          </button>
                        );
                      })}
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
