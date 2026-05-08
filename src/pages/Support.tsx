import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import {
  Headphones,
  Plus,
  Ticket,
  Send,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function Support() {
  const { t, lang } = useTranslation();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<"technical" | "billing" | "content" | "general">("general");
  const [expandedTicket, setExpandedTicket] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data: myTickets, isLoading } = trpc.support.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const utils = trpc.useUtils();
  const createMutation = trpc.support.create.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      setSubject("");
      setMessage("");
      utils.support.list.invalidate();
    },
  });

  const replyMutation = trpc.support.reply.useMutation({
    onSuccess: () => {
      setReplyText("");
      utils.support.list.invalidate();
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]">
        <div className="text-center">
          <Headphones className="mx-auto h-12 w-12 text-[#1f2d44]" />
          <p className="mt-4 text-lg text-[#94a3b8]">{lang === "en" ? "Please login to access support" : "يرجى تسجيل الدخول للوصول للدعم"}</p>
          <Button
            className="mt-4 bg-[#06b6d4] text-[#0a0e17]"
            onClick={() => navigate("/login")}
          >
            {t("login")}
          </Button>
        </div>
      </div>
    );
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    createMutation.mutate({ subject: subject.trim(), message: message.trim(), category, priority: "medium" });
  };

  const handleReply = (ticketId: number) => {
    if (!replyText.trim()) return;
    replyMutation.mutate({ ticketId, message: replyText.trim() });
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-4xl px-4 pb-20 lg:px-6">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#f0f4f8]">{t("support")}</h1>
            <p className="mt-1 text-sm text-[#94a3b8]">
              {lang === "en" ? "Get help with your courses and account" : "احصل على مساعدة بخصوص كورساتك وحسابك"}
            </p>
          </div>
          <Button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#0891b2]"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("createTicket")}
          </Button>
        </div>

        {/* Create Ticket Form */}
        {showCreate && (
          <div className="mb-8 rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#f0f4f8]">{t("createTicket")}</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm text-[#94a3b8]">{t("subject")}</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={lang === "en" ? "What's your issue about?" : "ما هي مشكلتك؟"}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div>
                <label className="text-sm text-[#94a3b8]">{lang === "en" ? "Category" : "الفئة"}</label>
                <div className="mt-1 flex gap-2">
                  {(["technical", "billing", "content", "general"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        category === c
                          ? "bg-[#06b6d4] text-[#0a0e17]"
                          : "border border-[#1f2d44] text-[#94a3b8] hover:border-[#06b6d4]"
                      }`}
                    >
                      {t(c)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-[#94a3b8]">{t("message")}</label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={lang === "en" ? "Describe your issue in detail..." : "صف مشكلتك بالتفصيل..."}
                  rows={4}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={createMutation.isPending || !subject.trim() || !message.trim()}
                  className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#0891b2]"
                >
                  {createMutation.isPending ? t("loading") : t("submit")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowCreate(false)}
                  className="text-[#94a3b8]"
                >
                  {t("cancel")}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Tickets List */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-[#f0f4f8]">{t("myTickets")}</h2>
          {isLoading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#1f2d44] border-t-[#06b6d4]" />
            </div>
          ) : myTickets && myTickets.length > 0 ? (
            <div className="space-y-3">
              {myTickets.map((ticket) => (
                <div key={ticket.id} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5">
                  <button
                    onClick={() => setExpandedTicket(expandedTicket === ticket.id ? null : ticket.id)}
                    className="flex w-full items-start justify-between text-start"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          ticket.status === "open" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" :
                          ticket.status === "in_progress" ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4]" :
                          ticket.status === "resolved" ? "bg-[rgba(6,182,212,0.15)] text-[#22d3ee]" :
                          "bg-[#1a2233] text-[#64748b]"
                        }`}>
                          {ticket.status}
                        </span>
                        <span className="text-xs text-[#64748b]">{ticket.category}</span>
                      </div>
                      <h3 className="mt-2 font-medium text-[#f0f4f8]">{ticket.subject}</h3>
                      <p className="mt-1 text-sm text-[#94a3b8] line-clamp-2">{ticket.message}</p>
                    </div>
                    {expandedTicket === ticket.id ? (
                      <ChevronUp className="ml-3 h-5 w-5 text-[#64748b]" />
                    ) : (
                      <ChevronDown className="ml-3 h-5 w-5 text-[#64748b]" />
                    )}
                  </button>

                  {expandedTicket === ticket.id && (
                    <div className="mt-4 border-t border-[#1f2d44] pt-4">
                      <p className="text-sm text-[#94a3b8]">{ticket.message}</p>
                      <div className="mt-4 flex gap-2">
                        <Input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={t("writeReply")}
                          className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b]"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleReply(ticket.id)}
                          disabled={replyMutation.isPending || !replyText.trim()}
                          className="bg-[#06b6d4] text-[#0a0e17]"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#1f2d44] bg-[#111827] py-16 text-center">
              <Ticket className="mx-auto h-12 w-12 text-[#1f2d44]" />
              <p className="mt-4 text-lg text-[#94a3b8]">{t("noTickets")}</p>
              <p className="mt-1 text-sm text-[#64748b]">{t("createFirstTicket")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
