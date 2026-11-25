/**
 * Server-side reader for the "subscribeGate" siteSettings section.
 * ══════════════════════════════════════════════════════════════════════════
 * The same config the admin dashboard edits (enabled / channelUrl / days)
 * drives the SERVER-side gate on lessonVideo + previewVideo. Reading goes
 * through the settings cache (identical to settings-router.getSection) and
 * FAILS CLOSED: on any read error the gate stays ON — never silently off.
 */

import { siteSettings } from "@db/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { CACHE_TTL, cacheKeys, getCache } from "./cache";
import { logger } from "./logger.js";
import { clampGateDays } from "./subscribe-ticket";

export const SUBSCRIBE_GATE_SECTION = "subscribeGate";
export const DEFAULT_GATE_DAYS = 30;

export interface SubscribeGateConfig {
  /** When false, the server does not require tickets (owner switch). */
  enabled: boolean;
  /** Unlock window in days (clamped 1..60) — also the ticket lifetime. */
  days: number;
}

export async function getSubscribeGateConfig(): Promise<SubscribeGateConfig> {
  try {
    const cache = getCache();
    const cacheKey = cacheKeys.settingsSection(SUBSCRIBE_GATE_SECTION);
    let raw = await cache.get<Record<string, string>>(cacheKey);
    if (!raw) {
      const db = getDb();
      const rows = await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.section, SUBSCRIBE_GATE_SECTION));
      raw = {};
      for (const row of rows) raw[row.key] = row.value;
      await cache.set(cacheKey, raw, CACHE_TTL.SETTINGS_SECTION);
    }
    const parsed = Number.parseInt(raw.days ?? "", 10);
    return {
      enabled: raw.enabled !== "false", // default ON — the owner contract
      days: Number.isFinite(parsed) && parsed >= 1 ? clampGateDays(parsed) : DEFAULT_GATE_DAYS,
    };
  } catch (err) {
    logger.warn("[SubscribeGate] config read failed — failing closed (gate ON)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { enabled: true, days: DEFAULT_GATE_DAYS };
  }
}
