import * as Sentry from "@sentry/node";
import { env } from "./env.js";

let initialized = false;

function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN || env.NODE_ENV === "development") return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.npm_package_version ?? "unknown",
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
    profilesSampleRate: 0.1,
    maxBreadcrumbs: 20,
    attachStacktrace: true,
    sendDefaultPii: false,
    denyUrls: [
      /\/api\/health/,
      /\/api\/ready/,
      /\/api\/live/,
    ],
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-api-key"];
      }
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      return event;
    },
    ignoreErrors: [
      "ValidationError",
      "ZodError",
      "AuthenticationError",
      "NotFoundError",
      "RateLimitError",
    ],
  });

  initialized = true;
}

function captureException(error: unknown, context?: {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id: string; email?: string; role?: string };
  level?: "fatal" | "error" | "warning" | "info";
}): void {
  initSentry();
  if (!env.SENTRY_DSN || env.NODE_ENV === "development") return;

  const sentryContext: Sentry.EventHint & Record<string, unknown> = {};

  if (context?.tags) sentryContext.tags = context.tags;
  if (context?.extra) sentryContext.extra = context.extra;
  if (context?.user) {
    sentryContext.user = {
      id: context.user.id,
      email: context.user.email,
      role: context.user.role,
    };
  }

  Sentry.captureException(error, {
    ...(context?.level && { level: context.level }),
    ...(context?.tags && { tags: context.tags }),
    ...(context?.extra && { extra: context.extra }),
    ...(context?.user && { user: { id: context.user.id, email: context.user.email, role: context.user.role } }),
  });
}

function captureMessage(message: string, level: "fatal" | "error" | "warning" | "info" | "debug" = "info"): void {
  initSentry();
  if (!env.SENTRY_DSN || env.NODE_ENV === "development") return;
  Sentry.captureMessage(message, level);
}

function captureSecurityEvent(event: {
  type: string;
  details: Record<string, unknown>;
  severity: "critical" | "high" | "medium" | "low";
  ip?: string;
  userId?: number;
}): void {
  initSentry();
  if (!env.SENTRY_DSN || env.NODE_ENV === "development") return;

  Sentry.withScope((scope) => {
    scope.setTag("security_event", event.type);
    scope.setTag("severity", event.severity);
    scope.setLevel(event.severity === "critical" ? "fatal" : event.severity === "high" ? "error" : "warning");
    scope.setExtra("security_details", event.details);
    if (event.ip) scope.setExtra("source_ip", event.ip);
    if (event.userId) scope.setUser({ id: event.userId.toString() });

    Sentry.captureMessage(`Security Event: ${event.type}`, event.severity === "critical" ? "fatal" : "error");
  });
}

function flushSentry(): Promise<boolean> {
  if (!initialized) return Promise.resolve(true);
  return Sentry.flush(2000);
}

export { initSentry, captureException, captureMessage, captureSecurityEvent, flushSentry };
