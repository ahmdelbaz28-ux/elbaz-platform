import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeNotifications, useShowNotification } from "@/components/NotificationCenter";

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
  const { isAuthenticated } = useAuth();
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
    }) => {
      const isRtl = document.documentElement.dir !== "ltr";
      const openUrl = (url: string) => {
        if (url.startsWith("/")) navigate(url);
        else window.open(url, "_blank", "noopener,noreferrer");
      };

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
        type: (["youtube", "lesson", "file", "software"].includes(event.type)
          ? event.type
          : event.type === "enrollment"
            ? "enrollment"
            : "info") as "youtube" | "lesson" | "file" | "software" | "enrollment" | "info",
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
  void isAuthenticated;
  return null;
}
