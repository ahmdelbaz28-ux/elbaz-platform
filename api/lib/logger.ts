type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Sanitize strings destined for log output (SonarCloud S5145 — Log Injection):
 * strips CR/LF and control characters so forged log lines / ANSI escape
 * sequences cannot be smuggled into the aggregated console stream. JSON
 * escaping alone is not sufficient because downstream log shippers may
 * re-decode \n / \u001b sequences.
 */
function sanitizeForLog(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: this regex IS the control-character sanitizer for log lines
  return value.replace(/[\x00-\x1F\x7F]/g, " ").slice(0, 2000); // eslint-disable-line no-control-regex
}

/**
 * ✅ SECURITY FIX (pre-launch audit run-2, logs.pii-emails): mask user email
 * addresses before they reach the log stream — logs ship to the hosting
 * platform and are readable by anyone with runtime access. Keeps the first
 * character of the local part and the full domain (enough for the operator
 * to correlate an incident) e.g. `a***@domain.com`.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(no-email)";
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return "(malformed-email)";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    // ✅ SECURITY FIX (audit run-1, csp-report.log-sink): non-string meta used
    // to bypass both the control-character sanitizer and the size cap, so an
    // attacker-supplied object (e.g. POST /api/csp-report) was serialized
    // verbatim into the log stream. Bound every value.
    out[sanitizeForLog(k)] = typeof v === "string"
      ? sanitizeForLog(v)
      : sanitizeForLog(JSON.stringify(v) ?? String(v));
  }
  return out;
}

function structuredLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message: sanitizeForLog(message),
    ...sanitizeMeta(meta),
  };
  const output = JSON.stringify(entry);
  switch (level) {
    case "error":
      // NOSONAR(S5145) — every string passed through sanitizeForLog() above
      // (CR/LF + control chars stripped) and JSON.stringify escapes the rest;
      // the analyzer cannot model the custom sanitizer, so this is a
      // documented false-positive suppression.
      console.error(output); // NOSONAR
      break;
    case "warn":
      console.warn(output); // NOSONAR — sanitized via sanitizeForLog() (see error case)
      break;
    default:
      console.log(output); // NOSONAR — sanitized via sanitizeForLog() (see error case)
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => structuredLog("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => structuredLog("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => structuredLog("error", message, meta),
};
