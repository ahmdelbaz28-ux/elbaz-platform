import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import {
  Headphones,
  Plus,
  Ticket as TicketIcon,
  Send,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function TicketThread({ ticketId, initialMessage }: { readonly ticketId: number, readonly initialMessage: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [replyText, setReplyText] = useState("");

  const { data: ticketDetail, isLoading } = trpc.support.getById.useQuery({ id: ticketId });
  const replyMutation = trpc.support.reply.useMutation({
    onSuccess: () => {
      setReplyText("");
      utils.support.getById.invalidate({ id: ticketId });
      utils.support.list.invalidate();
    },
  });

  const handleReply = () => {
    if (!replyText.trim()) return;
    replyMutation.mutate({ ticketId, message: replyText.trim() });
  };

  if (isLoading) return <div className="py-4 text-center text-sm text-text-muted">{t("loading")}</div>;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
        <div className="flex flex-col items-start">
          <div className="rounded-lg bg-primary px-4 py-2 text-sm text-foreground">
            {initialMessage}
          </div>
        </div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {ticketDetail?.replies?.map((reply: any) => (
          <div key={reply.id} className={`flex flex-col ${reply.isAdminReply ? "items-start" : "items-end"}`}>
            <span className="mb-1 text-[10px] text-text-muted">{reply.isAdminReply ? "Support Team" : "You"}</span>
            <div className={`rounded-lg px-4 py-2 text-sm ${reply.isAdminReply ? "bg-accent-secondary/15 text-accent border border-accent-secondary/20" : "bg-primary text-foreground"}`}>
              {reply.message}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={t("writeReply")} className="flex-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary" onKeyDown={(e) => e.key === "Enter" && handleReply()} />
        <Button size="sm" onClick={handleReply} disabled={replyMutation.isPending || !replyText.trim()} className="bg-accent-secondary text-background hover:bg-accent-secondary/80">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface Ticket {
  id: number;
  userId: number;
  subject: string;
  message: string;
  category: string;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TicketsResponse {
  items: Ticket[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

export default function Support() {
  const { t, lang } = useTranslation();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<"technical" | "billing" | "content" | "general">("general");
  const [expandedTicket, setExpandedTicket] = useState<number | null>(null);

  const { data: ticketsData, isLoading } = trpc.support.list.useQuery<TicketsResponse>(undefined, { enabled: isAuthenticated });
  const tickets = ticketsData?.items ?? [];

  const utils = trpc.useUtils();
  const createMutation = trpc.support.create.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      setSubject("");
      setMessage("");
      utils.support.list.invalidate();
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Headphones className="mx-auto h-12 w-12 text-border" />
          <p className="mt-4 text-lg text-text-muted">{lang === "en" ? "Please login to access support" : "يرجى تسجيل الدخول للوصول للدعم"}</p>
          <Button className="mt-4 bg-accent-secondary text-background hover:bg-accent-secondary/80" onClick={() => navigate("/login")}>{t("login")}</Button>
        </div>
      </div>
    );
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    createMutation.mutate({ subject: subject.trim(), message: message.trim(), category, priority: "medium" });
  };

  const ticketsContent = tickets?.length > 0 ? (
    <div className="space-y-3">
      {tickets.map((ticket: Ticket) => {
        const statusColorResolved = ticket.status === "resolved" ? "bg-accent-secondary/15 text-accent" : "bg-primary text-text-muted";
        const statusColorInProgress = ticket.status === "in_progress" ? "bg-accent-secondary/15 text-accent-secondary" : statusColorResolved;
        const ticketStatusColor = ticket.status === "open" ? "bg-emerald-500/15 text-emerald-500" : statusColorInProgress;
        return (
          <div key={ticket.id} className="rounded-xl border border-border bg-primary p-5">
            <button onClick={() => setExpandedTicket(expandedTicket === ticket.id ? null : ticket.id)} className="flex w-full items-start justify-between text-start">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${ticketStatusColor}`}>{ticket.status}</span>
                  <span className="text-xs text-text-muted">{ticket.category}</span>
                </div>
                <h3 className="mt-2 font-medium text-foreground">{ticket.subject}</h3>
                <p className="mt-1 text-sm text-text-muted line-clamp-2">{ticket.message}</p>
              </div>
              {expandedTicket === ticket.id ? <ChevronUp className="ml-3 h-5 w-5 text-text-muted" /> : <ChevronDown className="ml-3 h-5 w-5 text-text-muted" />}
            </button>

            {expandedTicket === ticket.id && <TicketThread ticketId={ticket.id} initialMessage={ticket.message} />}
          </div>
        );
      })}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border bg-primary py-16 text-center">
      <TicketIcon className="mx-auto h-12 w-12 text-border" />
      <p className="mt-4 text-lg text-text-muted">{t("noTickets")}</p>
      <p className="mt-1 text-sm text-text-muted">{t("createFirstTicket")}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pt-24">
      <div className="mx-auto max-w-4xl px-4 pb-20 lg:px-6">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("support")}</h1>
            <p className="mt-1 text-sm text-text-muted">{lang === "en" ? "Get help with your courses and account" : "احصل على مساعدة بخصوص كورساتك وحسابك"}</p>
          </div>
          <Button onClick={() => setShowCreate(!showCreate)} className="bg-accent-secondary text-background hover:bg-accent-secondary/80">
            <Plus className="mr-2 h-4 w-4" />
            {t("createTicket")}
          </Button>
        </div>

        {showCreate && (
          <div className="mb-8 rounded-xl border border-border bg-primary p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">{t("createTicket")}</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="support-subject" className="text-sm text-text-muted">{t("subject")}</label>
                <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={lang === "en" ? "What's your issue about?" : "ما هي مشكلتك؟"} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
              </div>
              <div>
                <span className="text-sm text-text-muted">{lang === "en" ? "Category" : "الفئة"}</span>
                <div className="mt-1 flex gap-2">
                  {(["technical", "billing", "content", "general"] as const).map((c) => (
                    <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${category === c ? "bg-accent-secondary text-background" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
                      {t(c)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="support-message" className="text-sm text-text-muted">{t("message")}</label>
                <Textarea id="support-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={lang === "en" ? "Describe your issue in detail..." : "صف مشكلتك بالتفصيل..."} rows={4} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary" />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={createMutation.isPending || !subject.trim() || !message.trim()} className="bg-accent-secondary text-background hover:bg-accent-secondary/80">
                  {createMutation.isPending ? t("loading") : t("submit")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)} className="text-text-muted">{t("cancel")}</Button>
              </div>
            </form>
          </div>
        )}

        <div>
          <h2 className="mb-4 text-lg font-semibold text-foreground">{t("myTickets")}</h2>
          {isLoading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-secondary" />
            </div>
          ) : ticketsContent}
        </div>
      </div>
    </div>
  );
}
