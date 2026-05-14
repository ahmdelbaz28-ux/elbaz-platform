import { Context, Next } from "hono";

interface AuditLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "critical";
  action: string;
  userId: string | null;
  ip: string;
  path: string;
  method: string;
  statusCode: number;
  responseTime: number;
  userAgent: string;
  complianceTags: string[];
  injectionDetected: boolean;
}

const PII_PATTERNS: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  creditCard: /\b(?:\d[ -]*?){13,16}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
};

const INJECTION_PATTERNS: RegExp[] = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION|EXEC|EXECUTE)\b.*\b(FROM|INTO|WHERE|TABLE|DATABASE)\b)/i,
  /(<\s*script[^>]*>)/i,
  /(javascript\s*:)/i,
  /(\bon\w+\s*=)/i,
  /(document\.(cookie|location|write))/i,
  /(\.\.\.\/|\.\.\\)/,
  /(<\s*iframe[^>]*>)/i,
  /(expression\s*\()/i,
  /(@\w+\s+--)/,
  /('(\s)*(OR|AND)(\s)*')/i,
];

function maskPII(data: string): string {
  let sanitized = data;
  sanitized = sanitized.replace(PII_PATTERNS.email, "[REDACTED-EMAIL]");
  sanitized = sanitized.replace(PII_PATTERNS.phone, "[REDACTED-PHONE]");
  sanitized = sanitized.replace(PII_PATTERNS.creditCard, "[REDACTED-CARD]");
  sanitized = sanitized.replace(PII_PATTERNS.ssn, "[REDACTED-SSN]");
  return sanitized;
}

function detectInjection(data: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(data));
}

function classifySeverity(statusCode: number, responseTime: number): "info" | "warn" | "error" | "critical" {
  if (statusCode >= 500) return "critical";
  if (statusCode >= 400) return "error";
  if (statusCode >= 300) return "warn";
  if (responseTime > 5000) return "warn";
  return "info";
}

function determineComplianceTags(path: string, method: string, statusCode: number, userId: string | null): string[] {
  const tags: string[] = [];

  if (path.includes("/admin")) {
    tags.push("admin-action");
  }
  if (path.includes("/auth")) {
    tags.push("authentication");
  }
  if (path.includes("/payment") || path.includes("/billing") || path.includes("/subscription")) {
    tags.push("financial-data");
    tags.push("pci-scope");
  }
  if (path.includes("/user") || path.includes("/profile")) {
    tags.push("gdpr-relevant");
  }
  if (method === "DELETE" && statusCode >= 200 && statusCode < 300) {
    tags.push("data-deletion");
  }
  if (method === "POST" && path.includes("/user") && statusCode >= 200 && statusCode < 300) {
    tags.push("gdpr-relevant");
    tags.push("data-collection");
  }

  return tags;
}

function auditLogger() {
  return async (c: Context, next: Next): Promise<void> => {
    const startTime = Date.now();
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || "unknown";
    const method = c.req.method;
    const path = c.req.path;
    const userAgent = c.req.header("user-agent") || "unknown";

    const rawBody = await c.req.text().catch(() => "");
    const queryString = c.req.query.toString();
    const injectionDetected = detectInjection(rawBody) || detectInjection(queryString);

    await next();

    const responseTime = Date.now() - startTime;
    const statusCode = c.res.status;
    const userId = c.get("userId") || c.get("user")?.id?.toString() || null;

    const level = classifySeverity(statusCode, responseTime);
    const complianceTags = determineComplianceTags(path, method, statusCode, userId);

    const logEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      action: `${method} ${path}`,
      userId,
      ip: maskPII(ip),
      path: maskPII(path),
      method,
      statusCode,
      responseTime,
      userAgent: maskPII(userAgent),
      complianceTags,
      injectionDetected,
    };

    if (injectionDetected) {
      logEntry.level = "critical";
      complianceTags.push("potential-injection");
    }

    if (statusCode >= 500) {
      complianceTags.push("server-error");
    }

    console.log(JSON.stringify(logEntry));

    if (logEntry.level === "critical") {
      console.error(JSON.stringify({
        ...logEntry,
        alert: true,
        alertType: injectionDetected ? "injection-attempt" : "critical-error",
      }));
    }
  };
}

export { auditLogger, maskPII, detectInjection, classifySeverity, determineComplianceTags };
export type { AuditLogEntry };
