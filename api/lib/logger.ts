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
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, " ").slice(0, 2000);
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[sanitizeForLog(k)] = typeof v === "string" ? sanitizeForLog(v) : v;
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
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => structuredLog("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => structuredLog("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => structuredLog("error", message, meta),
};
