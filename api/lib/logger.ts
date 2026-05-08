import { env } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  duration?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Minimum level that will actually be emitted (debug in dev, info in prod). */
const MIN_LEVEL: LogLevel = env.isProduction ? "info" : "debug";

const LEVEL_EMOJI: Record<LogLevel, string> = {
  debug: "\u{1F4CB}",
  info: "\u2139\uFE0F",
  warn: "\u26A0\uFE0F",
  error: "\u{1F6A8}",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

function isoTimestamp(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

class Logger {
  private context: Record<string, unknown>;

  constructor(initialContext?: Record<string, unknown>) {
    this.context = initialContext || {};
  }

  // -----------------------------------------------------------------------
  // Child logger – merges additional context with the current context
  // -----------------------------------------------------------------------

  child(additionalContext: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  // -----------------------------------------------------------------------
  // Core log methods
  // -----------------------------------------------------------------------

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit("warn", message, context);
  }

  /**
   * Log an error. Accepts an optional `Error` (or any unknown value) and
   * additional context. The error's message and stack are merged into
   * the structured entry automatically.
   */
  error(
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
  ): void {
    const errorContext: Record<string, unknown> = { ...context };

    if (error instanceof Error) {
      errorContext.errorName = error.name;
      errorContext.errorMessage = error.message;
      errorContext.stack = error.stack;
    } else if (error !== undefined) {
      errorContext.error = error;
    }

    this.emit("error", message, errorContext);
  }

  // -----------------------------------------------------------------------
  // Performance timing
  // -----------------------------------------------------------------------

  /**
   * Starts a timer. Call the returned function to stop the timer and get
   * the elapsed time in milliseconds. The elapsed time is automatically
   * logged at `info` level with the provided label.
   *
   * @example
   * ```ts
   * const end = logger.time("db-query");
   * await db.select().from(users);
   * const ms = end(); // logs: db-query completed in 42ms
   * ```
   */
  time(label: string): () => number {
    const start = performance.now();

    return (): number => {
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      this.info(`${label} completed in ${elapsed}ms`, {
        timingLabel: label,
        durationMs: elapsed,
      });
      return elapsed;
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Format and emit a log entry if its level meets the minimum threshold. */
  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;

    const entry: LogEntry = {
      timestamp: isoTimestamp(),
      level,
      message,
      ...(this.context && Object.keys(this.context).length ? { context: this.context } : {}),
      ...(context && Object.keys(context).length ? { ...context } : {}),
    };

    if (env.isProduction) {
      // Structured JSON for log aggregation tools (Datadog, Loki, etc.)
      console.log(JSON.stringify(entry));
    } else {
      // Coloured, human-friendly output for local development
      const color = LEVEL_COLOR[level];
      const emoji = LEVEL_EMOJI[level];
      const prefix = `${color}${emoji} [${level.toUpperCase()}]${RESET}`;

      let line = `${prefix} ${message}`;

      if (entry.errorName) {
        line += `\n  ${color}Name:   ${entry.errorName as string}${RESET}`;
      }
      if (entry.errorMessage) {
        line += `\n  ${color}Error:  ${entry.errorMessage as string}${RESET}`;
      }
      if (entry.stack) {
        line += `\n  ${color}Stack:  ${RESET}${(entry.stack as string)
          .split("\n")
          .join("\n  ")}`;
      }

      const extraKeys = Object.keys(entry).filter(
        (k) =>
          !["timestamp", "level", "message", "context", "errorName", "errorMessage", "stack"].includes(k),
      );

      if (extraKeys.length > 0) {
        const data: Record<string, unknown> = {};
        for (const k of extraKeys) data[k] = entry[k];
        line += `\n  ${color}Data:${RESET} ${JSON.stringify(data, null, 2)
          .split("\n")
          .join("\n  ")}`;
      }

      if (entry.context && Object.keys(entry.context).length > 0) {
        line += `\n  ${color}Ctx:${RESET} ${JSON.stringify(entry.context, null, 2)
          .split("\n")
          .join("\n  ")}`;
      }

      switch (level) {
        case "debug":
          console.debug(line);
          break;
        case "warn":
          console.warn(line);
          break;
        case "error":
          console.error(line);
          break;
        default:
          console.log(line);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Default logger instance with no pre-set context. */
export const logger = new Logger();

export { Logger };
export type { LogLevel, LogEntry };
