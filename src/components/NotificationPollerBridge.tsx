import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useRealtimeNotifications, useShowNotification } from "@/components/NotificationCenter";
import { playApprovalChime, showDeviceNotification, vibrateApproval } from "@/lib/approval-chime";

const KNOWN_TOAST_TYPES = new Set(["youtube", "lesson", "file", "software"]);

type ToastType = "youtube" | "lesson" | "file" | "software" | "enrollment" | "info";

/** Map a server event type onto the toast taxonomy (unknown types → "info"). */
function toastTypeFor(type: string): ToastType {
  if (KNOWN_TOAST_TYPES.has(type)) return type as ToastType;
  if (type === "enrollment") return "enrollment";
  return "info";
}

/**
 * NotificationPollerBridge — the invisible component that makes server
 * notifications REAL for the user.
 *
 * Mounted once (inside NotificationProvider) for logged-in users. It polls
 * /api/notifications/poll every 15s and turns every new event into:
 *   - a live toast (bottom/top, auto-dismiss, with a click action), and
 *   - a persisted entry in the bell history (via useShowNotification).
 *
 * Event → toast mapping:
 *   youtube  → red toast, action opens the video in a new tab
 *   lesson   → action navigates to the course page inside the SPA
 *   file     → action navigates to /references
 *   software → action navigates home (downloads section)
 *   promo/system → informational toast
 */
export default function NotificationPollerBridge() {
  const { showNotification } = useShowNotification();
  const navigate = useNavigate();

  const onNewEvent = useCallback(
    (event: {
      id: string;
      type: string;
      title: string;
      message: string;
      url?: string;
      channelUrl?: string;
      data?: unknown;
    }) => {
      const isRtl = document.documentElement.dir !== "ltr";
      const openUrl = (url: string) => {
        if (url.startsWith("/")) navigate(url);
        // ✅ SECURITY FIX (audit run-1): http(s) URLs only — never open a
        // javascript:/data: destination from a notification payload.
        else if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      };

      // ✅ ADMIN APPROVAL GATE (owner directive, 2026-11-24): a registration
      // that needs approval is the ONE event class that must break through —
      // chime + haptic buzz + device-level notification on every open client
      // of an admin (the toast below still fires; only admins ever receive
      // these events because the fan-out targets admin streams only).
      const approvalData = (event.data as { approvalRequest?: { username?: string; name?: string } } | undefined)?.approvalRequest;
      if (approvalData) {
        playApprovalChime();
        vibrateApproval();
        showDeviceNotification(
          isRtl ? "طلب انضمام جديد للمنصة" : "New join request",
          isRtl
            ? `${approvalData.name || approvalData.username || "مستخدم جديد"} سجل في المنصة ويحتاج موافقتك`
            : `${approvalData.name || approvalData.username || "A new user"} registered and needs your approval`,
          `approval-${approvalData.username ?? event.id}`,
        );
      }

      const actionLabel = (() => {
        if (!event.url) return undefined;
        switch (event.type) {
          case "youtube":
            return isRtl ? "شاهد الحلقة الآن" : "Watch now";
          case "lesson":
            return isRtl ? "افتح الكورس" : "Open course";
          case "file":
            return isRtl ? "حمّل الملف" : "Get the file";
          case "software":
            return isRtl ? "حمّل البرنامج" : "Download";
          default:
            return undefined;
        }
      })();

      showNotification({
        // Pass the server type through — the toast system colors/icons it
        // (youtube → red YouTube icon) and the bell stores it for display.
        type: toastTypeFor(event.type),
        title: event.title,
        message: event.message,
        eventId: event.id,
        url: event.url,
        channelUrl: event.channelUrl,
        duration: event.type === "youtube" ? 9000 : 7000,
        ...(actionLabel && event.url
          ? { action: { label: actionLabel, onClick: () => openUrl(event.url as string) } }
          : {}),
      });
    },
    [showNotification, navigate],
  );

  useRealtimeNotifications({ interval: 15_000, onNewEvent });

  // Polling only activates when authenticated (handled inside the hook);
  // this component renders nothing.
  return null;
}
