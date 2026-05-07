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
  private store = new Map<string, CacheEntry<any>>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  async get<T>(key: string): CacheResult<T> {
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
  private retryAttempts = 0;
  private maxRetries = 5;

  private async getClient(): Promise<any> {
    if (this.client && this.connected) return this.client;

    try {
      const Redis = (await import("ioredis")).default;
      this.client = new Redis(env.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 5) return null; // Stop retrying
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      this.client.on("error", (err: any) => {
        console.warn("[Cache] Redis error:", err.message);
        this.connected = false;
      });

      this.client.on("connect", () => {
        this.connected = true;
        this.retryAttempts = 0;
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

  async get<T>(key: string): CacheResult<T> {
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

export function getCache(): MemoryLRUCache | RedisCache {
  if (cacheInstance) return cacheInstance;

  if (env.redisUrl && env.redisUrl !== "redis://localhost:6379" && env.redisUrl.length > 20) {
    console.log("[Cache] Using Redis:", env.redisUrl.substring(0, 30) + "...");
    cacheInstance = new RedisCache();
  } else {
    console.log("[Cache] Using in-memory LRU cache (no Redis configured)");
    cacheInstance = new MemoryLRUCache(500);
  }

  return cacheInstance;
}

// ─── Predefined TTL Constants ────────────────────────────────────────────────

export const CACHE_TTL = {
  /** Course list — 5 minutes (changes when admin updates) */
  COURSES: 5 * 60,
  /** Categories — 30 minutes (rarely changes) */
  CATEGORIES: 30 * 60,
  /** Testimonials — 15 minutes */
  TESTIMONIALS: 15 * 60,
  /** Homepage stats — 10 minutes */
  STATS: 10 * 60,
  /** Single course detail — 5 minutes */
  COURSE_DETAIL: 5 * 60,
  /** Lesson progress (per user) — 2 minutes */
  LESSON_PROGRESS: 2 * 60,
  /** Saved position (per user) — 3 minutes */
  SAVED_POSITION: 3 * 60,
  /** Rate limit window — uses the same TTL as the rate limit config */
  RATE_LIMIT: 15 * 60,
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
} as const;
