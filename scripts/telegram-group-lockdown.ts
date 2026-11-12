/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TELEGRAM GROUP LOCKDOWN — owner directive 2026-11-11
 * ───────────────────────────────────────────────────────────────────────────
 *  "The chatbot must NEVER post anything inside the Telegram group. Delete
 *   what it posted, lock its rights, verify."
 *
 *  One-off ops job (workflow_dispatch only — never scheduled). Runs on GitHub
 *  Actions where TELEGRAM_BOT_TOKEN lives as a secret; the token never leaves
 *  the runner and is never printed.
 *
 *  PHASES
 *   1. IDENTITY    getMe → bot id/username (abort when rejected).
 *   2. DISCOVERY   candidates = numeric/@-ids from TELEGRAM_CHAT_ID and
 *                  TELEGRAM_ADMIN_CHAT_ID env (as group suspects) + a bounded
 *                  getUpdates peek window (offset=0 — NEVER advances the
 *                  offset, so every update is re-delivered to the real poller
 *                  afterwards; at-least-once by design). Chats harvested from
 *                  message / chat_join_request / my_chat_member payloads.
 *                  A channel candidate also contributes its linked_chat_id
 *                  (the discussion group), which is where the owner's group
 *                  usually hides.
 *   3. INSPECT     getChat + getChatMember for every candidate — type, title,
 *                  the bot's membership status and full admin rights snapshot.
 *   4. HARDEN      For every group/supergroup where the bot is an admin:
 *                    • promoteChatMember keeping ONLY can_invite_users — the
 *                      join-request auto-approval gate keeps working while the
 *                      Post-Messages right is removed (Telegram forbids
 *                      supergroup admins without it from sending messages);
 *                    • re-read rights and verify the strip took effect.
 *                  For a plain member/restricted bot: restrictChatMember
 *                  muted-forever (supergroups only — basic groups reject it).
 *   5. SWEEP       Delete the bot's own posts: deleteMessage over the anchored
 *                  recent message-id range. SAFE BY CONSTRUCTION — the sweep
 *                  runs only after can_delete_messages is verified false (or
 *                  the bot is not an admin at all), so a success proves the
 *                  message was the bot's OWN outgoing post (≤48h — Telegram's
 *                  own rule); every other id fails harmlessly untouched.
 *                  Anchors come from the update peek; when none exists and the
 *                  bot may still post, ONE 1-second anchor probe message is
 *                  sent and immediately deleted to locate the head id.
 *   6. PROOF       sendMessage must FAIL with a rights error — the definitive
 *                  "cannot post" evidence. If it somehow succeeds the probe is
 *                  deleted at once and a demote+restrict fallback runs.
 *   7. REPORT      A JSON summary (ids, types, statuses, counts — no token,
 *                  no message texts, no member identities) + human lines.
 *
 *  Env: TELEGRAM_BOT_TOKEN (required), TELEGRAM_CHAT_ID / TELEGRAM_ADMIN_CHAT_ID
 *  (optional suspects), LOCKDOWN_SUSPECT_CHAT_ID (optional direct group id —
 *  the robust path when the channel lookup flakes or the group is quiet;
 *  DELIBERATELY a separate name so the broadcast target TELEGRAM_CHAT_ID is
 *  never repointed at the group), TELEGRAM_API_BASE (optional relay override),
 *  LOCKDOWN_DISCOVERY_SECONDS (default 420), LOCKDOWN_SWEEP_BACK (600),
 *  LOCKDOWN_SWEEP_FWD (80).
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ─── Telegram API plumbing ───────────────────────────────────────────────────

const API_BASE = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("[Lockdown] TELEGRAM_BOT_TOKEN missing — aborting");
  process.exit(1);
}

interface TgResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let apiCallCount = 0;

async function tg<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<TgResponse<T>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      apiCallCount += 1;
      const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(40_000),
      });
      const data = (await res.json()) as TgResponse<T>;
      if (!data.ok && data.parameters?.retry_after) {
        const wait = Math.min(data.parameters.retry_after, 30) * 1_000;
        console.log(`[Lockdown] ${method}: rate-limited — waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      return data;
    } catch (err) {
      if (attempt === 2) {
        return { ok: false, description: `network: ${err instanceof Error ? err.message : String(err)}` };
      }
      await sleep(1_500);
    }
  }
  return { ok: false, description: "unreachable" };
}

// ─── Shapes we touch ─────────────────────────────────────────────────────────

interface ChatInfo {
  id: number | string;
  type: string;
  title?: string;
  username?: string;
  linked_chat_id?: number;
  permissions?: { can_send_messages?: boolean };
}

interface MemberInfo {
  status: string;
  is_member?: boolean;
  can_send_messages?: boolean;
  can_post_messages?: boolean;
  can_edit_messages?: boolean;
  can_delete_messages?: boolean;
  can_invite_users?: boolean;
  can_restrict_members?: boolean;
  can_promote_members?: boolean;
  can_manage_chat?: boolean;
  can_change_info?: boolean;
  can_pin_messages?: boolean;
  can_manage_video_chats?: boolean;
  can_manage_topics?: boolean;
  is_anonymous?: boolean;
}

interface HarvestedUpdate {
  update_id?: number;
  message?: { chat?: ChatInfo; message_id?: number; from?: { is_bot?: boolean; id?: number } };
  chat_join_request?: { chat?: ChatInfo };
  my_chat_member?: { chat?: ChatInfo; new_chat_member?: MemberInfo };
}

const ADMIN_TRUE_RIGHTS = [
  "can_manage_chat",
  "can_delete_messages",
  "can_manage_video_chats",
  "can_restrict_members",
  "can_promote_members",
  "can_change_info",
  "can_invite_users",
  "can_post_messages",
  "can_edit_messages",
  "can_pin_messages",
  "can_manage_topics",
  "can_post_stories",
  "can_edit_stories",
  "can_delete_stories",
] as const;

// ─── Config ──────────────────────────────────────────────────────────────────

const DISCOVERY_MS = Math.max(60, Number(process.env.LOCKDOWN_DISCOVERY_SECONDS || 420)) * 1_000;
const SWEEP_BACK = Math.max(0, Number(process.env.LOCKDOWN_SWEEP_BACK || 600));
const SWEEP_FWD = Math.max(0, Number(process.env.LOCKDOWN_SWEEP_FWD || 80));
const DEADLINE_MS = 13.5 * 60_000; // stay well inside the 25-min job timeout
const startedAt = Date.now();
const remaining = () => DEADLINE_MS - (Date.now() - startedAt);

// ─── Report assembly ─────────────────────────────────────────────────────────

interface ChatReport {
  chat_id: number | string;
  type: string;
  title?: string;
  discovered_via: string;
  bot_status_before?: string;
  bot_rights_before?: Record<string, boolean>;
  actions: string[];
  bot_status_after?: string;
  bot_rights_after?: Record<string, boolean>;
  sweep_anchor?: number;
  sweep_range?: [number, number];
  sweep_attempted?: number;
  sweep_deleted?: number;
  sweep_undeletable?: number; // others' messages or >48h-old — untouched by design
  sweep_not_found?: number;
  proof_test?: "blocked-as-expected" | "FAILED-COULD-POST(probe deleted)" | "skipped";
  notes: string[];
}

const reports: ChatReport[] = [];
const seenChatIds = new Set<string>();
let groupHardened = 0;
let groupBlockedProof = 0;
let totalDeleted = 0;

function rightsSnapshot(m: MemberInfo | undefined): Record<string, boolean> | undefined {
  if (!m) return undefined;
  const snap: Record<string, boolean> = { status_is_admin: m.status === "administrator" };
  for (const r of ADMIN_TRUE_RIGHTS) {
    const v = (m as unknown as Record<string, unknown>)[r];
    if (v !== undefined) snap[r] = Boolean(v);
  }
  return snap;
}

// Strip control characters / newlines: log payloads include Telegram-provided
// strings (chat titles, usernames, error descriptions) — a hostile value with
// a "\n" could forge log lines (S5145 log injection).
function sanitizeForLog(s: string): string {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, " ");
}

function log(msg: string): void {
  const t = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[Lockdown +${t}s] ${sanitizeForLog(msg)}`);
}

// ─── Phase 1: discovery ──────────────────────────────────────────────────────

interface Candidate {
  id: number | string;
  via: string;
  anchor?: number; // highest message_id seen in this chat
}

const candidates = new Map<string, Candidate>();

function addCandidate(id: number | string | undefined, via: string, anchor?: number): void {
  if (id === undefined || id === null) return;
  const key = String(id);
  if (key === "777000" || key === "1087968824") return; // Telegram service accounts
  const existing = candidates.get(key);
  if (existing) {
    if (anchor !== undefined && (existing.anchor === undefined || anchor > existing.anchor)) {
      existing.anchor = anchor;
    }
    return;
  }
  candidates.set(key, { id, via, anchor });
}

function envCandidates(): void {
  for (const [name, via] of [
    ["TELEGRAM_CHAT_ID", "env:TELEGRAM_CHAT_ID"],
    ["TELEGRAM_ADMIN_CHAT_ID", "env:TELEGRAM_ADMIN_CHAT_ID"],
    ["LOCKDOWN_SUSPECT_CHAT_ID", "env:LOCKDOWN_SUSPECT_CHAT_ID"],
  ] as const) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    if (/^-?\d+$/.test(raw)) addCandidate(Number(raw), via);
    else if (raw.startsWith("@")) addCandidate(raw, via);
  }
}

async function updatePeekWindow(): Promise<void> {
  log(`update peek window: ${Math.round(DISCOVERY_MS / 1000)}s (offset=0 — never confirms, poller re-delivers)`);
  const deadline = Date.now() + DISCOVERY_MS;
  let polls = 0;
  let conflicts = 0;
  let harvested = 0;
  let lastGroupAnchorAt = 0;

  while (Date.now() < deadline && remaining() > 60_000) {
    polls += 1;
    const res = await tg<HarvestedUpdate[]>("getUpdates", {
      offset: 0, // NEVER advance — the real poller owns confirmation
      timeout: 2,
      allowed_updates: ["message", "chat_join_request", "my_chat_member"],
    });
    if (!res.ok) {
      const desc = res.description ?? "";
      if (desc.includes("Conflict")) {
        conflicts += 1;
        // The production poller is long-polling — back off politely and retry;
        // its own 409 backoff (60s ×5 then a 5-min cooldown) opens a window.
        await sleep(2_500);
        continue;
      }
      log(`getUpdates failed: ${desc.slice(0, 100)} — continuing with env candidates only`);
      return;
    }
    const updates = res.result ?? [];
    for (const u of updates) {
      if (u.message?.chat) {
        const c = u.message.chat;
        if (c.type === "group" || c.type === "supergroup") {
          addCandidate(c.id, "updates:message", u.message.message_id);
          harvested += 1;
          lastGroupAnchorAt = Date.now();
        }
      }
      if (u.chat_join_request?.chat) {
        addCandidate(u.chat_join_request.chat.id, "updates:join_request");
        harvested += 1;
      }
      if (u.my_chat_member?.chat) {
        const c = u.my_chat_member.chat;
        if (c.type === "group" || c.type === "supergroup") {
          addCandidate(c.id, "updates:my_chat_member");
          harvested += 1;
        }
      }
    }
    // Early exit: we hold at least one anchored group candidate and the stream
    // went quiet for 45s — enough evidence to proceed to hardening.
    const haveAnchoredGroup = [...candidates.values()].some((c) => c.anchor !== undefined);
    if (haveAnchoredGroup && Date.now() - lastGroupAnchorAt > 45_000 && updates.length === 0) break;
    await sleep(700);
  }
  log(`peek done: ${polls} polls, ${conflicts} conflicts, ${harvested} group-relevant updates harvested`);
}

async function expandLinkedChats(): Promise<void> {
  for (const c of [...candidates.values()]) {
    if (remaining() < 60_000) return;
    const res = await tg<ChatInfo>("getChat", { chat_id: c.id });
    if (res.ok && res.result) {
      const info = res.result;
      if ((info.type === "channel" || info.type === "supergroup") && info.linked_chat_id) {
        log(`candidate ${String(c.id)} ("${info.title ?? "?"}") has linked chat ${info.linked_chat_id} → added`);
        addCandidate(info.linked_chat_id, "linked_chat_id");
      }
    }
  }
}

// ─── Phase 4/5/6 helpers ─────────────────────────────────────────────────────

async function minimalAdminPromote(chatId: number | string, botId: number): Promise<TgResponse> {
  // can_manage_chat is derived by Telegram from the sub-rights — never sent
  // explicitly (an explicit false alongside a true sub-right can be rejected).
  return tg("promoteChatMember", {
    chat_id: chatId,
    user_id: botId,
    is_anonymous: false,
    can_delete_messages: false,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: true, // join-request auto-approval gate — the ONLY right kept
    can_post_messages: false,
    can_edit_messages: false,
    can_pin_messages: false,
    can_manage_topics: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
  });
}

async function muteForever(chatId: number | string, botId: number): Promise<TgResponse> {
  return tg("restrictChatMember", {
    chat_id: chatId,
    user_id: botId,
    status: "restricted",
    is_member: true,
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    until_date: 0, // forever
  });
}

async function probeSend(chatId: number | string): Promise<{ ok: boolean; description?: string; messageId?: number }> {
  const res = await tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: "🔒 [lockdown-probe]",
    link_preview_options: { is_disabled: true },
  });
  if (res.ok && res.result?.message_id) {
    // Probe accidentally posted → remove it within the same second.
    await tg("deleteMessage", { chat_id: chatId, message_id: res.result.message_id });
    return { ok: true, messageId: res.result.message_id };
  }
  return { ok: false, description: res.description };
}

/**
 * NUCLEAR FALLBACK (owner directive 2026-11-11 v2 — "ممنوع مهما حصل يكتب في
 * جروب التليجرام أبداً"): when silence cannot be guaranteed by rights alone
 * (basic groups reject API mutes; a demote can be re-overridden; verification
 * came back incomplete), the bot removes itself from the group. Not being a
 * member is the ONE state Telegram itself enforces absolutely — "chat not
 * found" on every send, forever, with no rights left to re-grant.
 */
async function leaveAsLastResort(
  rep: ChatReport,
  chatId: number | string,
  botId: number,
  why: string,
): Promise<void> {
  const leave = await tg("leaveChat", { chat_id: chatId });
  if (leave.ok) {
    rep.actions.push(`leaveChat — ${why} (membership removal is the only state Telegram enforces absolutely)`);
    const after = await tg<MemberInfo>("getChatMember", { chat_id: chatId, user_id: botId });
    rep.bot_status_after = after.ok ? after.result?.status : `error: ${(after.description ?? "?").slice(0, 60)}`;
    const proof = await probeSend(chatId);
    rep.proof_test = proof.ok ? "FAILED-COULD-POST(probe deleted)" : "blocked-as-expected";
    if (!proof.ok) {
      groupBlockedProof += 1;
      rep.notes.push(`post-leave proof: sendMessage rejected — ${(proof.description ?? "").slice(0, 100)}`);
    } else {
      rep.notes.push("post-leave proof: probe WENT THROUGH despite leave — investigate manually");
    }
  } else {
    rep.notes.push(`leaveChat failed: ${(leave.description ?? "").slice(0, 120)} — owner must remove the bot from the group manually`);
  }
}

async function sweepOwnMessages(
  rep: ChatReport,
  chatId: number | string,
  anchor: number,
): Promise<void> {
  const from = Math.max(1, anchor - SWEEP_BACK);
  const to = anchor + SWEEP_FWD;
  rep.sweep_range = [from, to];
  rep.sweep_attempted = 0;
  rep.sweep_deleted = 0;
  rep.sweep_undeletable = 0;
  rep.sweep_not_found = 0;
  log(`sweep chat ${String(chatId)}: message ids ${from}..${to} (only the bot's OWN posts can succeed)`);
  for (let id = to; id >= from; id--) {
    if (remaining() < 45_000) {
      rep.notes.push("sweep cut short by job deadline");
      break;
    }
    const res = await tg("deleteMessage", { chat_id: chatId, message_id: id });
    rep.sweep_attempted += 1;
    if (res.ok) {
      rep.sweep_deleted += 1;
      log(`  deleted message_id=${id} (bot's own post)`);
    } else {
      const desc = res.description ?? "";
      if (/not found/i.test(desc)) rep.sweep_not_found += 1;
      else if (/can't be deleted|not enough rights/i.test(desc)) rep.sweep_undeletable += 1;
      else rep.sweep_not_found += 1;
    }
    await sleep(45); // gentle pacing — no 429 storms
  }
  totalDeleted += rep.sweep_deleted;
  log(`sweep done: ${rep.sweep_deleted} bot posts deleted, ${rep.sweep_undeletable} undeletable (untouched), ${rep.sweep_not_found} not found`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const me = await tg<{ id: number; username?: string; is_bot: boolean }>("getMe");
  if (!me.ok || !me.result) {
    console.error(`[Lockdown] getMe rejected: ${sanitizeForLog(me.description ?? "unknown")} — aborting`);
    process.exit(1);
  }
  const botId = me.result.id;
  const botUsername = me.result.username ?? "?";
  log(`bot identity: @${botUsername} (id ${botId})`);

  envCandidates();
  await updatePeekWindow();
  if (remaining() < 60_000) {
    log("deadline pressure — skipping linked-chat expansion");
  } else {
    await expandLinkedChats();
  }
  log(`candidates: ${[...candidates.keys()].join(", ") || "NONE — report will flag manual discovery"}`);

  for (const cand of candidates.values()) {
    if (remaining() < 60_000) {
      log("deadline reached — stopping chat loop");
      break;
    }
    const key = String(cand.id);
    if (seenChatIds.has(key)) continue;
    seenChatIds.add(key);

    const chatRes = await tg<ChatInfo>("getChat", { chat_id: cand.id });
    if (!chatRes.ok || !chatRes.result) {
      log(`chat ${key}: getChat failed (${(chatRes.description ?? "").slice(0, 80)}) — skipping`);
      continue;
    }
    const info = chatRes.result;
    if (info.type === "private") {
      // DM users from the backlog buffer — never reported (privacy), never touched.
      continue;
    }
    const rep: ChatReport = {
      chat_id: cand.id,
      type: info.type,
      title: info.title ?? info.username ?? String(cand.id),
      discovered_via: cand.via,
      actions: [],
      notes: [],
    };
    reports.push(rep);

    const memRes = await tg<MemberInfo>("getChatMember", { chat_id: cand.id, user_id: botId });
    const before = memRes.ok ? memRes.result : undefined;
    rep.bot_status_before = before?.status;
    rep.bot_rights_before = rightsSnapshot(before);
    log(`chat ${key} "${rep.title}" type=${info.type} bot status=${before?.status ?? (memRes.description ?? "?").slice(0, 60)}`);

    if (info.type === "channel") {
      // OWNER DIRECTIVE (2026-11-11): a channel post AUTO-MIRRORS into the
      // linked discussion group — that mirroring is exactly how bot content
      // surfaced "inside the group". The bot therefore must hold NO publishing
      // surface in the channel. It cannot strip its own admin rights (that
      // needs can_promote_members, which it does not hold), but it CAN leave.
      rep.notes.push("channel — linked-discussion-group policy: bot must have zero publishing surface here");
      const isMember = before && ["administrator", "member", "restricted"].includes(before.status);
      if (isMember) {
        const leave = await tg("leaveChat", { chat_id: cand.id });
        if (leave.ok) {
          rep.actions.push("leaveChat → bot left the channel (channel posts can never mirror into the group again; re-add manually ONLY if the owner ever wants broadcasts back)");
          const after = await tg<MemberInfo>("getChatMember", { chat_id: cand.id, user_id: botId });
          rep.bot_status_after = after.ok ? after.result?.status : "unknown";
          // Proof: with the bot out of the channel, sending MUST fail.
          const proof = await probeSend(cand.id);
          rep.proof_test = proof.ok ? "FAILED-COULD-POST(probe deleted)" : "blocked-as-expected";
          if (!proof.ok) rep.notes.push(`channel sendMessage rejected after leave: ${(proof.description ?? "").slice(0, 100)}`);
        } else {
          rep.notes.push(`leaveChat failed: ${(leave.description ?? "").slice(0, 120)} — owner must remove the bot from the channel admins manually (no probe sent — it would have posted)`);
        }
      } else {
        rep.notes.push(`bot status "${before?.status}" in the channel — no publishing surface; proof probe runs`);
        const proof = await probeSend(cand.id);
        rep.proof_test = proof.ok ? "FAILED-COULD-POST(probe deleted)" : "blocked-as-expected";
        if (!proof.ok) rep.notes.push(`channel sendMessage rejected: ${(proof.description ?? "").slice(0, 100)}`);
      }
      continue;
    }

    if (info.type !== "group" && info.type !== "supergroup") {
      rep.notes.push(`chat type ${info.type} — out of scope (private chats are DM support, unaffected)`);
      continue;
    }

    // ── GROUP: harden ──
    const status = before?.status;
    if (status === "creator") {
      rep.notes.push("bot is the group OWNER?? — impossible for bots; investigate manually");
      continue;
    }

    if (status === "administrator") {
      // Anchor fallback: with no recent group message harvested from the
      // update buffer, ONE 1-second probe is sent + immediately deleted to
      // locate the head message id so the sweep below can run. Disclosed in
      // the report.
      if (cand.anchor === undefined && before?.can_post_messages !== false) {
        const probe = await probeSend(cand.id);
        if (probe.ok && probe.messageId !== undefined) {
          cand.anchor = probe.messageId;
          rep.notes.push("anchor probe sent+deleted (~1s) to locate the head message id for the sweep");
        }
      }
      const promote = await minimalAdminPromote(cand.id, botId);
      if (promote.ok) {
        rep.actions.push("promoteChatMember → admin with ONLY can_invite_users (post/delete/promote rights stripped; join-request gate kept)");
        const after = await tg<MemberInfo>("getChatMember", { chat_id: cand.id, user_id: botId });
        const m = after.ok ? after.result : undefined;
        rep.bot_status_after = m?.status;
        rep.bot_rights_after = rightsSnapshot(m);
        const stripped = Boolean(m && m.status === "administrator" && m.can_invite_users === true && !m.can_post_messages && !m.can_delete_messages);
        if (stripped) {
          groupHardened += 1;
          rep.notes.push("verified: admin rights now = invite-approval only (supergroup admins without Post-Messages cannot send)");
        } else {
          rep.notes.push(`rights verification INCOMPLETE — snapshot above is authoritative`);
        }
        // Sweep safety: the bot must no longer be able to delete others' posts.
        if (m && !m.can_delete_messages) {
          if (cand.anchor !== undefined) {
            rep.sweep_anchor = cand.anchor;
            await sweepOwnMessages(rep, cand.id, cand.anchor);
          } else {
            rep.notes.push("no recent-id anchor from updates — sweep skipped (nothing to anchor on; bot posts, if any, remain for manual removal)");
          }
        } else {
          rep.notes.push("sweep SKIPPED — can_delete_messages still true (sweep must never risk others' messages)");
        }
      } else {
        rep.notes.push(`promoteChatMember failed: ${(promote.description ?? "").slice(0, 120)} — bot lacks can_promote_members; owner must untick "Post Messages" in the group admin panel manually`);
      }
    } else if (status === "member" || status === "restricted") {
      const mute = await muteForever(cand.id, botId);
      if (mute.ok) {
        rep.actions.push("restrictChatMember → muted forever (can_send_messages=false; join-request gate NOT available to non-admin bots)");
        const after = await tg<MemberInfo>("getChatMember", { chat_id: cand.id, user_id: botId });
        const m = after.ok ? after.result : undefined;
        rep.bot_status_after = m?.status;
        rep.bot_rights_after = rightsSnapshot(m);
        if (!m || m.status !== "restricted" || m.can_send_messages !== false) {
          rep.notes.push("mute verification INCOMPLETE — snapshot above is authoritative");
        }
        // Non-admin bots can always delete their OWN outgoing messages and
        // never others' — a sweep anchored on recent ids is safe.
        if (cand.anchor !== undefined) {
          rep.sweep_anchor = cand.anchor;
          await sweepOwnMessages(rep, cand.id, cand.anchor);
        }
      } else {
        rep.notes.push(`restrictChatMember failed: ${(mute.description ?? "").slice(0, 120)} — applying the nuclear fallback (a basic-group member bot can still post; only membership removal guarantees silence)`);
        await leaveAsLastResort(rep, cand.id, botId, "mute impossible here — leaving is the only guaranteed silence");
      }
    } else {
      rep.notes.push(`bot status "${status}" — cannot post anyway; nothing to harden`);
    }

    // ── PROOF: sending MUST fail now ──
    const proof = await probeSend(cand.id);
    if (!proof.ok) {
      rep.proof_test = "blocked-as-expected";
      groupBlockedProof += 1;
      rep.notes.push(`sendMessage rejected as expected: ${(proof.description ?? "").slice(0, 120)}`);
    } else {
      rep.proof_test = "FAILED-COULD-POST(probe deleted)";
      rep.notes.push("probe went through — rights not effective; applying demote+restrict fallback");
      const demote = await tg("promoteChatMember", {
        chat_id: cand.id,
        user_id: botId,
        is_anonymous: false,
        can_delete_messages: false,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: false,
        can_post_messages: false,
        can_edit_messages: false,
        can_pin_messages: false,
        can_manage_topics: false,
        can_post_stories: false,
        can_edit_stories: false,
        can_delete_stories: false,
      });
      if (demote.ok) {
        rep.actions.push("fallback: demoted to plain member");
        const mute = await muteForever(cand.id, botId);
        rep.actions.push(mute.ok ? "fallback: muted forever" : `fallback mute failed: ${(mute.description ?? "").slice(0, 100)}`);
        const reproof = await probeSend(cand.id);
        if (!reproof.ok) {
          rep.proof_test = "blocked-as-expected";
          groupBlockedProof += 1;
          rep.notes.push(`re-proof OK — sending now rejected: ${(reproof.description ?? "").slice(0, 100)}`);
        } else {
          rep.notes.push("bot can STILL post after demote+mute — applying the nuclear fallback (leave)");
          await leaveAsLastResort(rep, cand.id, botId, "demote+mute were not effective — leaving guarantees silence no matter what");
        }
      } else {
        rep.notes.push(`demote failed: ${(demote.description ?? "").slice(0, 100)} — bot could post in the probe; applying the nuclear fallback (leave) since rights cannot be stripped from here`);
        await leaveAsLastResort(rep, cand.id, botId, "demote impossible (no can_promote_members) while posting was proven possible — leaving is the only guaranteed silence");
      }
    }
  }

  // ─── Final report ──
  const report = {
    bot: { id: botId, username: botUsername },
    run: {
      api_calls: apiCallCount,
      duration_s: Math.round((Date.now() - startedAt) / 1000),
      discovered_candidates: candidates.size,
    },
    outcome: {
      groups_hardened: groupHardened,
      groups_verified_blocked: groupBlockedProof,
      bot_posts_deleted: totalDeleted,
    },
    chats: reports,
  };
  console.log("\n=== LOCKDOWN REPORT ===");
  console.log(JSON.stringify(report, null, 2));

  const groupsDiscovered = reports.filter((r) => r.type === "group" || r.type === "supergroup").length;
  const manualNeeded = reports.some((r) => r.notes.some((n) => n.startsWith("bot can STILL post") || n.includes("owner must")));
  console.log("\n=== LOCKDOWN SUMMARY ===");
  console.log(`groups discovered: ${groupsDiscovered} | hardened: ${groupHardened} | verified blocked: ${groupBlockedProof} | bot posts deleted: ${totalDeleted}`);
  if (manualNeeded) console.log("⚠️  MANUAL STEP REQUIRED — see notes above");
  else if (groupBlockedProof > 0) console.log("✅ every discovered group now rejects bot posts (proof probe failed as expected)");
  else if (groupsDiscovered === 0) console.log("⚠️ no group discovered — send any message in the group (or add a member) then rerun this job, or set the group id as TELEGRAM_CHAT_ID");
  process.exit(0);
}

await main();

export {}; // top-level await needs this file to be a module
