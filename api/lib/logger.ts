type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

function structuredLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...meta,
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
