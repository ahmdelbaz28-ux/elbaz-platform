import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { env } from "../lib/env.js";

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);

  const publicPaths = ["/api/health", "/api/ready", "/api/live"];
  if (publicPaths.some((p) => c.req.path.startsWith(p))) {
    return next();
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  if (!token || token.split(".").length !== 3) {
    return c.json({ error: "Invalid token format" }, 401);
  }

  try {
    const payload = await verify(token, env.APP_SECRET, "HS256");

    if (!payload.sub || !payload.userId) {
      return c.json({ error: "Invalid token payload" }, 401);
    }

    if (payload.type === "access" && payload.exp && Date.now() >= payload.exp * 1000) {
      return c.json({ error: "Token expired" }, 401);
    }

    c.set("session", {
      userId: payload.userId as number,
      email: payload.email as string,
      role: payload.role as string,
      tokenId: payload.jti as string,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("expired")) {
      return c.json({ error: "Token expired" }, 401);
    }
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await next();
});
