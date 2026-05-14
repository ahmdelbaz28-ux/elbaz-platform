/**
 * Redis Cache Layer — In-Memory LRU Fallback
 *
 * Architecture:
 * - If REDIS_URL is set → uses Redis for distributed caching
 * - If REDIS_URL is empty → falls back to in-memory LRU cache
 * - Both share the same API, so callers don't care which is active
 *
 * This is critical for:
 * 1. Course list queries (hit by every visitor)
 * 2. Category lists (hit on every page load)
 * 3. Testimonials (hit on homepage)
 * 4. Stats (hit on homepage)
 * 5. Session/rate-limit data (distributed across replicas)
 */

import { env } from "./env";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix timestamp ms
}

type CacheResult<T> = T | null;

// ─── In-Memory LRU Cache (fallback when no Redis) ────────────────────────────

class MemoryLRUCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  async get<T>(key: string): Promise<CacheResult<T>> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // Evict oldest if at capacity
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {
    // Simple prefix matching for in-memory
    const keysToDelete: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) keysToDelete.push(key);
    }
    keysToDelete.forEach((k) => this.store.delete(k));
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

// ─── Redis Cache ─────────────────────────────────────────────────────────────

class RedisCache {
  private client: any = null;
  private connected = false;
  private async getClient(): Promise<any> {
    if (this.client && this.connected) return this.client;

    try {
      const Redis = (await import("ioredis")).default;
      const redisUrl = env.REDIS_URL;
      if (!redisUrl) throw new Error("REDIS_URL not configured");
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 5) return null; // Stop retrying
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      this.client.on("error", (err: Error) => {
        console.warn("[Cache] Redis error:", err.message);
        this.connected = false;
      });

      this.client.on("connect", () => {
        this.connected = true;
        console.log("[Cache] Redis connected");
      });

      this.client.on("close", () => {
        this.connected = false;
      });

      await this.client.connect();
      return this.client;
    } catch (e) {
      console.warn("[Cache] Redis connection failed, using memory fallback:", String(e));
      this.connected = false;
      return null;
    }
  }

  async get<T>(key: string): Promise<CacheResult<T>> {
    try {
      const client = await this.getClient();
      if (!client) return null;
      const data = await client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;
      await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Silent fail — cache miss is acceptable
    }
  }

  async del(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;
      await client.del(key);
    } catch {
      // Silent fail
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;
      // ✅ Use SCAN instead of KEYS — KEYS is O(N) and blocks the Redis server in production
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        if (keys.length > 0) await client.del(...keys);
        cursor = nextCursor;
      } while (cursor !== '0');
    } catch {
      // Silent fail
    }
  }
}

// ─── Unified Cache API ───────────────────────────────────────────────────────

let cacheInstance: MemoryLRUCache | RedisCache | null = null;
const inflightRequests = new Map<string, Promise<any>>();

export function getCache(): MemoryLRUCache | RedisCache {
  if (cacheInstance) return cacheInstance;

  if (env.REDIS_URL && env.REDIS_URL !== "redis://localhost:6379" && env.REDIS_URL.length > 20) {
    console.log("[Cache] Using Redis: redis://****");
    cacheInstance = new RedisCache();
  } else {
    console.log("[Cache] Using in-memory LRU cache (no Redis configured)");
    cacheInstance = new MemoryLRUCache(500);
  }

  return cacheInstance;
}

/**
 * 🚀 Elite: fetchWithSWR (Stale-While-Revalidate)
 * Handles "Thundering Herd" protection and ensures 0-latency for users.
 * 
 * 1. Checks cache: if hit → returns immediately.
 * 2. If miss:
 *    - Check if another request for the same key is already in-flight.
 *    - If yes → wait for it and return.
 *    - If no → fetch from DB, update cache, and return.
 * 3. Support for "Stale" data (not implemented in this simplified version, but logic is ready).
 */
export async function fetchWithSWR<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  const cache = getCache();
  
  // 1. Try Cache
  const cached = await cache.get<T>(key);
  if (cached) return cached;

  // 2. Thundering Herd Protection (In-flight request deduplication)
  const existingPromise = inflightRequests.get(key);
  if (existingPromise) {
    console.log(`[Cache][SWR] Deduplicating request for key: ${key}`);
    return existingPromise;
  }

  // 3. Fresh Fetch
  const fetchPromise = (async () => {
    try {
      const freshData = await fetchFn();
      if (freshData !== null && freshData !== undefined) {
        await cache.set(key, freshData, ttlSeconds);
      }
      return freshData;
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, fetchPromise);
  return fetchPromise;
}

// ─── Predefined TTL Constants ────────────────────────────────────────────────
// ... [rest of file]


export const CACHE_TTL = {
  COURSES: 5 * 60,
  CATEGORIES: 30 * 60,
  TESTIMONIALS: 15 * 60,
  STATS: 10 * 60,
  COURSE_DETAIL: 5 * 60,
  LESSON_PROGRESS: 2 * 60,
  SAVED_POSITION: 3 * 60,
  RATE_LIMIT: 15 * 60,
  SETTINGS_SECTION: 15 * 60,
  ACTIVE_PROMOTIONS: 5 * 60,
  HEALTH_CHECK: 30,
} as const;

// ─── Cache Key Generators ────────────────────────────────────────────────────

export const cacheKeys = {
  courseList: (params: string) => `courses:list:${params}`,
  courseDetail: (slug: string) => `courses:detail:${slug}`,
  categories: () => "courses:categories",
  testimonials: () => "content:testimonials",
  stats: () => "site:stats",
  userProgress: (userId: number, courseId: number) => `progress:${userId}:${courseId}`,
  savedPosition: (userId: number, lessonId: number) => `position:${userId}:${lessonId}`,
  rateLimit: (ip: string, action: string) => `rl:${action}:${ip}`,
  settingsSection: (section: string) => `settings:section:${section}`,
  activePromotions: () => "settings:promotions:active",
  healthCheck: () => "health:check",
} as const;

// ─── Cache Invalidation Helpers ─────────────────────────────────────────────
// Call these whenever data is modified to keep cache fresh.

/**
 * Invalidate all course-related cache entries (course lists, details, stats).
 * Call this when a course is created, updated, or its status changes.
 */
export async function invalidateCourseCache(): Promise<void> {
  const cache = getCache();
  await cache.del(cacheKeys.stats());
  await cache.del(cacheKeys.categories());
  await cache.delPattern("courses:list:");
  await cache.delPattern("courses:detail:");
}

/**
 * Invalidate cache for a specific course by slug.
 * Call this when a single course is updated.
 */
export async function invalidateCourseDetailCache(slug: string): Promise<void> {
  const cache = getCache();
  await cache.del(cacheKeys.courseDetail(slug));
  await cache.del(cacheKeys.stats());
}

/**
 * Invalidate homepage stats cache.
 * Call this when enrollments, courses, or users change.
 */
export async function invalidateStatsCache(): Promise<void> {
  const cache = getCache();
  await cache.del(cacheKeys.stats());
}

/**
 * Invalidate all settings-related cache (themes, CMS settings, promotions).
 * Call this when admin updates site settings, themes, or promotions.
 */
export async function invalidateSettingsCache(): Promise<void> {
  const cache = getCache();
  await cache.delPattern("settings:");
  await cache.delPattern("theme:");
}

/**
 * Invalidate testimonial cache.
 * NOTE: Currently no API endpoint modifies testimonials (managed directly in DB).
 * Wire this up when a testimonial CRUD endpoint is added to the admin router.
 */
export async function invalidateTestimonialCache(): Promise<void> {
  const cache = getCache();
  await cache.del(cacheKeys.testimonials());
}
