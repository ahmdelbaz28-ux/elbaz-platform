import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env to use in-memory LRU (no Redis)
vi.mock("./env", () => ({
  env: {
    redisUrl: "",
    isProduction: false,
  },
}));

import { getCache, CACHE_TTL, cacheKeys } from "./cache";

describe("Cache Module (Memory LRU)", () => {
  let cache: ReturnType<typeof getCache>;

  beforeEach(async () => {
    // getCache() returns a singleton, but since modules are re-loaded per test file,
    // we get a fresh instance. Clear all entries before each test.
    cache = getCache();
    await cache.delPattern("");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── get() ─────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("returns null for missing keys", async () => {
      const result = await cache.get("nonexistent:key");
      expect(result).toBeNull();
    });

    it("returns null after key has been deleted", async () => {
      await cache.set("temp:key", "value", 60);
      await cache.del("temp:key");
      expect(await cache.get("temp:key")).toBeNull();
    });
  });

  // ─── set() + get() ─────────────────────────────────────────────────────

  describe("set() and get()", () => {
    it("stores and retrieves a string value", async () => {
      await cache.set("test:string", "hello world", 60);
      expect(await cache.get("test:string")).toBe("hello world");
    });

    it("stores and retrieves a number value", async () => {
      await cache.set("test:number", 42, 60);
      expect(await cache.get<number>("test:number")).toBe(42);
    });

    it("stores and retrieves an object value", async () => {
      const obj = { name: "Bassem", role: "admin", courses: [1, 2, 3] };
      await cache.set("test:object", obj, 60);
      expect(await cache.get<typeof obj>("test:object")).toEqual(obj);
    });

    it("stores and retrieves an array value", async () => {
      const arr = ["a", "b", "c"];
      await cache.set("test:array", arr, 60);
      expect(await cache.get<string[]>("test:array")).toEqual(arr);
    });

    it("overwrites an existing key", async () => {
      await cache.set("test:overwrite", "first", 60);
      await cache.set("test:overwrite", "second", 60);
      expect(await cache.get("test:overwrite")).toBe("second");
    });

    it("overwrites value of a different type", async () => {
      await cache.set("test:retype", "string-value", 60);
      await cache.set("test:retype", { nested: true }, 60);
      expect(await cache.get("test:retype")).toEqual({ nested: true });
    });
  });

  // ─── TTL expiration ────────────────────────────────────────────────────

  describe("TTL expiration", () => {
    it("returns null after TTL expires (1s TTL)", async () => {
      await cache.set("test:ttl", "expires-soon", 1);

      // Immediately: value exists
      expect(await cache.get("test:ttl")).toBe("expires-soon");

      // Wait 1.1 seconds
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // After TTL: should be null
      expect(await cache.get("test:ttl")).toBeNull();
    });

    it("keeps value alive before TTL expires", async () => {
      await cache.set("test:alive", "still-here", 5);

      // Wait 500ms (well before 5s TTL)
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(await cache.get("test:alive")).toBe("still-here");
    });

    it("0-second TTL expires immediately", async () => {
      await cache.set("test:zero-ttl", "instant-expire", 0);

      // Even though TTL is 0, Date.now() + 0 = now, and the check is Date.now() > expiresAt
      // So it should expire on the next read (after any time passes)
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await cache.get("test:zero-ttl")).toBeNull();
    });
  });

  // ─── LRU eviction ──────────────────────────────────────────────────────

  describe("LRU eviction", () => {
    it("evicts oldest entry when cache is full (maxSize=500)", async () => {
      // Fill cache to capacity (500 entries)
      for (let i = 0; i < 500; i++) {
        await cache.set(`lru:key:${i}`, `value-${i}`, 300);
      }

      // NOTE: Don't call get() before eviction — get() moves entries to end (MRU),
      // which would change which entry is "oldest".

      // Add one more — should evict the oldest (key:0, first inserted)
      await cache.set("lru:key:new", "new-value", 300);

      // Oldest should be gone (it was first in the Map, evicted by set)
      expect(await cache.get("lru:key:0")).toBeNull();

      // Newest should exist
      expect(await cache.get("lru:key:new")).toBe("new-value");

      // Other entries should still exist
      expect(await cache.get("lru:key:1")).toBe("value-1");
      expect(await cache.get("lru:key:499")).toBe("value-499");
    });

    it("evicts least recently used entry after access pattern", async () => {
      // Fill to capacity
      for (let i = 0; i < 500; i++) {
        await cache.set(`lru2:key:${i}`, `value-${i}`, 300);
      }

      // Access key:0 (moves it to most-recently-used)
      await cache.get("lru2:key:0");

      // Access key:1 (moves it to most-recently-used)
      await cache.get("lru2:key:1");

      // Add two new entries — should evict key:2 and key:3 (oldest untouched)
      await cache.set("lru2:key:new1", "new1", 300);
      await cache.set("lru2:key:new2", "new2", 300);

      // key:0 and key:1 were recently accessed, should still exist
      expect(await cache.get("lru2:key:0")).toBe("value-0");
      expect(await cache.get("lru2:key:1")).toBe("value-1");

      // Newest entries should exist
      expect(await cache.get("lru2:key:new1")).toBe("new1");
      expect(await cache.get("lru2:key:new2")).toBe("new2");
    });
  });

  // ─── del() ─────────────────────────────────────────────────────────────

  describe("del()", () => {
    it("removes an existing key", async () => {
      await cache.set("del:test", "delete-me", 60);
      expect(await cache.get("del:test")).toBe("delete-me");

      await cache.del("del:test");
      expect(await cache.get("del:test")).toBeNull();
    });

    it("does nothing for non-existent keys", async () => {
      // Should not throw
      await cache.del("del:nonexistent");
      expect(await cache.get("del:nonexistent")).toBeNull();
    });
  });

  // ─── delPattern() ──────────────────────────────────────────────────────

  describe("delPattern()", () => {
    it("removes all keys matching a prefix", async () => {
      await cache.set("courses:list:page1", "data1", 60);
      await cache.set("courses:list:page2", "data2", 60);
      await cache.set("courses:list:page3", "data3", 60);
      await cache.set("courses:detail:slug1", "detail1", 60);
      await cache.set("courses:detail:slug2", "detail2", 60);
      await cache.set("users:active", "users", 60);

      await cache.delPattern("courses:list:");

      // All courses:list:* should be gone
      expect(await cache.get("courses:list:page1")).toBeNull();
      expect(await cache.get("courses:list:page2")).toBeNull();
      expect(await cache.get("courses:list:page3")).toBeNull();

      // Other keys should remain
      expect(await cache.get("courses:detail:slug1")).toBe("detail1");
      expect(await cache.get("courses:detail:slug2")).toBe("detail2");
      expect(await cache.get("users:active")).toBe("users");
    });

    it("removes nothing when no keys match the prefix", async () => {
      await cache.set("keep:this", "value", 60);
      await cache.delPattern("nonexistent:prefix:");
      expect(await cache.get("keep:this")).toBe("value");
    });

    it("removes all keys when pattern is empty string", async () => {
      await cache.set("a:1", "v1", 60);
      await cache.set("b:2", "v2", 60);
      await cache.set("c:3", "v3", 60);

      await cache.delPattern("");

      expect(await cache.get("a:1")).toBeNull();
      expect(await cache.get("b:2")).toBeNull();
      expect(await cache.get("c:3")).toBeNull();
    });
  });

  // ─── Cache key generators ──────────────────────────────────────────────

  describe("cacheKeys generators", () => {
    it("generates correct course list key", () => {
      expect(cacheKeys.courseList("page=1&cat=2")).toBe(
        "courses:list:page=1&cat=2"
      );
    });

    it("generates correct course detail key", () => {
      expect(cacheKeys.courseDetail("intro-to-ee")).toBe(
        "courses:detail:intro-to-ee"
      );
    });

    it("generates correct categories key", () => {
      expect(cacheKeys.categories()).toBe("courses:categories");
    });

    it("generates correct testimonials key", () => {
      expect(cacheKeys.testimonials()).toBe("content:testimonials");
    });

    it("generates correct stats key", () => {
      expect(cacheKeys.stats()).toBe("site:stats");
    });

    it("generates correct user progress key", () => {
      expect(cacheKeys.userProgress(42, 7)).toBe("progress:42:7");
    });

    it("generates correct saved position key", () => {
      expect(cacheKeys.savedPosition(42, 100)).toBe("position:42:100");
    });

    it("generates correct rate limit key", () => {
      expect(cacheKeys.rateLimit("1.2.3.4", "login")).toBe("rl:login:1.2.3.4");
    });
  });

  // ─── CACHE_TTL constants ───────────────────────────────────────────────

  describe("CACHE_TTL constants", () => {
    it("has correct TTL values in seconds", () => {
      expect(CACHE_TTL.COURSES).toBe(5 * 60); // 5 minutes
      expect(CACHE_TTL.CATEGORIES).toBe(30 * 60); // 30 minutes
      expect(CACHE_TTL.TESTIMONIALS).toBe(15 * 60); // 15 minutes
      expect(CACHE_TTL.STATS).toBe(10 * 60); // 10 minutes
      expect(CACHE_TTL.COURSE_DETAIL).toBe(5 * 60); // 5 minutes
      expect(CACHE_TTL.LESSON_PROGRESS).toBe(2 * 60); // 2 minutes
      expect(CACHE_TTL.SAVED_POSITION).toBe(3 * 60); // 3 minutes
      expect(CACHE_TTL.RATE_LIMIT).toBe(15 * 60); // 15 minutes
    });
  });
});
