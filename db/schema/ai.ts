/**
 * SCHEMA — AI Router domain (dynamic multi-provider chatbot gateway)
 *
 * Tables:
 *   aiProviders — admin-managed OpenAI-compatible providers (baseUrl + API key
 *                 + priority). The chatbot router iterates them in priority
 *                 order and fails over across them automatically.
 *   aiModels    — models discovered per provider via GET {baseUrl}/models,
 *                 classified chat vs vision, with per-model health state
 *                 (failCount/latency/status) used by the circuit breaker.
 *
 * SECURITY: aiProviders.apiKey is stored so the server can call the provider.
 * It is NEVER returned in full by any API — admin endpoints mask it
 * (first 3 + last 4 chars) and it is never logged.
 */

import {
  mysqlTable,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  int,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";

// ─────────────────────────────────────────────────────────────────────────────
// AI Providers (admin-managed)
// ─────────────────────────────────────────────────────────────────────────────
export const aiProviders = mysqlTable(
  "aiProviders",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    /** Stable unique slug used in logs + "provider/model" composite ids. */
    slug: varchar("slug", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 100 }).notNull(),
    /** OpenAI-compatible API root, e.g. https://api.groq.com/openai/v1 */
    baseUrl: varchar("baseUrl", { length: 255 }).notNull(),
    /** Bearer key — masked in every API response (maskApiKey). */
    apiKey: varchar("apiKey", { length: 512 }).notNull().default(""),
    /** Lower = tried first (admin-controlled). */
    priority: int("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    /** unknown | healthy | degraded | dead — mirrors the in-memory breaker. */
    status: varchar("status", { length: 16 }).notNull().default("unknown"),
    lastError: text("lastError"),
    lastCheckedAt: timestamp("lastCheckedAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_providers_slug_unique").on(table.slug),
    index("ai_providers_enabled_priority_idx").on(table.enabled, table.priority),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// AI Models (discovered per provider)
// ─────────────────────────────────────────────────────────────────────────────
export const aiModels = mysqlTable(
  "aiModels",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    providerId: bigint("providerId", { mode: "number", unsigned: true }).notNull(),
    /** Provider-native model id, e.g. "llama-3.3-70b-versatile" or "…:free". */
    modelId: varchar("modelId", { length: 190 }).notNull(),
    /** Can serve text-only chat requests. */
    supportsChat: boolean("supportsChat").notNull().default(true),
    /** Can serve image (vision) requests — mandatory routing flag. */
    supportsVision: boolean("supportsVision").notNull().default(false),
    /** Free-tier model (OpenRouter pricing === 0, or provider's free key tier). */
    isFree: boolean("isFree").notNull().default(true),
    /** Admin kill-switch per model. */
    enabled: boolean("enabled").notNull().default(true),
    /** Routing tier: 1 = strongest (thinking first), 3 = smallest/fastest (instant first). */
    tier: int("tier").notNull().default(2),
    /** Context window reported by the provider (tokens) — used to clamp
     *  max_tokens so small models (e.g. 4k ctx) don't 400 on thinking's 8192.
     *  NULL = unknown (older rows before the v10 migration). */
    contextLength: int("contextLength"),
    /** unknown | ok | limited | dead — last observed health. */
    status: varchar("status", { length: 16 }).notNull().default("unknown"),
    /** Consecutive failures (circuit breaker input). */
    failCount: int("failCount").notNull().default(0),
    lastError: varchar("lastError", { length: 500 }),
    lastSuccessAt: timestamp("lastSuccessAt", { mode: "date" }),
    lastUsedAt: timestamp("lastUsedAt", { mode: "date" }),
    /** Rolling latency of the last successful call (ms). */
    latencyMs: int("latencyMs"),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_models_provider_model_unique").on(table.providerId, table.modelId),
    index("ai_models_provider_idx").on(table.providerId),
    index("ai_models_enabled_tier_idx").on(table.enabled, table.tier),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [aiProviders.id],
      name: "fk_ai_models_provider",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
