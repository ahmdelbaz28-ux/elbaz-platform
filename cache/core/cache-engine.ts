// @ts-ignore - lru-cache missing types
import { LRUCache } from 'lru-cache';

interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  tags: string[];
  ttl: number;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  errors: number;
  hitRate: number;
  missRate: number;
  size: number;
  maxSize: number;
}

type CacheKey = string;

class CacheEngine {
  private store: LRUCache<CacheKey, CacheEntry>;
  private tagIndex: Map<string, Set<CacheKey>>;
  private metrics: {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    evictions: number;
    errors: number;
  };
  private defaultTTL: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null;
  private writeBackQueue: Array<{
    key: CacheKey;
    value: unknown;
    persistFn: (key: CacheKey, value: unknown) => Promise<void>;
    timeoutId: ReturnType<typeof setTimeout>;
  }>;
  private writeBackFlushInterval: ReturnType<typeof setInterval> | null;
  private writeBackDelay: number;
  private eventListeners: Map<string, Set<(data: unknown) => void>>;

  constructor(options: {
    maxSize?: number;
    defaultTTL?: number;
    cleanupIntervalMs?: number;
    writeBackDelay?: number;
  } = {}) {
    this.store = new LRUCache<CacheKey, CacheEntry>({
      max: options.maxSize ?? 5000,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      dispose: (entry: CacheEntry, key: CacheKey) => {
        this.metrics.evictions++;
        this.removeFromTagIndex(key, entry.tags);
      },
    });

    this.tagIndex = new Map();
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      errors: 0,
    };
    this.defaultTTL = options.defaultTTL ?? 300000;
    this.cleanupInterval = null;
    this.writeBackQueue = [];
    this.writeBackDelay = options.writeBackDelay ?? 5000;
    this.writeBackFlushInterval = null;
    this.eventListeners = new Map();

    if (options.cleanupIntervalMs && options.cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => this.evictExpired(), options.cleanupIntervalMs);
    }

    this.writeBackFlushInterval = setInterval(() => this.flushWriteBackQueue(), this.writeBackDelay);
  }

  get<T = unknown>(key: CacheKey): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.metrics.misses++;
      return undefined;
    }

    if (Date.now() - entry.createdAt > entry.ttl) {
      this.store.delete(key);
      this.removeFromTagIndex(key, entry.tags);
      this.metrics.misses++;
      return undefined;
    }

    entry.accessedAt = Date.now();
    entry.accessCount++;
    this.metrics.hits++;
    this.emit('get', { key, accessCount: entry.accessCount });
    return entry.value as T;
  }

  async getOrSet<T = unknown>(
    key: CacheKey,
    fetchFn: () => T | Promise<T>,
    options: { ttl?: number; tags?: string[] } = {}
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await Promise.resolve(fetchFn());
    this.set(key, value, options);
    return value;
  }

  set<T = unknown>(
    key: CacheKey,
    value: T,
    options: { ttl?: number; tags?: string[] } = {}
  ): void {
    const ttl = options.ttl ?? this.defaultTTL;
    const tags = options.tags ?? [];

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      accessCount: 0,
      tags,
      ttl,
    };

    if (this.store.has(key)) {
      const oldEntry = this.store.get(key)!;
      this.removeFromTagIndex(key, oldEntry.tags);
    }

    this.store.set(key, entry as CacheEntry);
    this.addToTagIndex(key, tags);
    this.metrics.sets++;
    this.emit('set', { key, ttl, tags });
  }

  has(key: CacheKey): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (Date.now() - entry.createdAt > entry.ttl) {
      this.store.delete(key);
      this.removeFromTagIndex(key, entry.tags);
      return false;
    }

    return true;
  }

  delete(key: CacheKey): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    this.removeFromTagIndex(key, entry.tags);
    const result = this.store.delete(key);
    if (result) {
      this.metrics.deletes++;
      this.emit('delete', { key });
    }
    return result;
  }

  deleteByTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;

    let count = 0;
    for (const key of keys) {
      if (this.delete(key)) {
        count++;
      }
    }
    this.tagIndex.delete(tag);
    this.emit('deleteByTag', { tag, count });
    return count;
  }

  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        if (this.delete(key)) {
          count++;
        }
      }
    }
    this.emit('deleteByPrefix', { prefix, count });
    return count;
  }

  deleteByPattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (pattern.test(key)) {
        if (this.delete(key)) {
          count++;
        }
      }
    }
    this.emit('deleteByPattern', { pattern: pattern.toString(), count });
    return count;
  }

  async writeBack<T = unknown>(
    key: CacheKey,
    value: T,
    persistFn: (key: CacheKey, value: T) => Promise<void>,
    options: { ttl?: number; tags?: string[] } = {}
  ): Promise<void> {
    this.set(key, value, options);

    const timeoutId = setTimeout(async () => {
      try {
        await persistFn(key, value as T);
        // Remove from queue after successful persist
        this.writeBackQueue = this.writeBackQueue.filter(item => item.key !== key || item.timeoutId !== timeoutId);
      } catch {
        this.metrics.errors++;
      }
    }, this.writeBackDelay);

    this.writeBackQueue.push({ key: key as CacheKey, value: value as unknown, persistFn: persistFn as (key: CacheKey, value: unknown) => Promise<void>, timeoutId });
  }

  async flushWriteBackQueue(): Promise<void> {
    // Clear all pending timeouts first
    for (const item of this.writeBackQueue) {
      if (item.timeoutId) {
        clearTimeout(item.timeoutId);
      }
    }
    // Execute all pending writes immediately
    const queue = [...this.writeBackQueue];
    this.writeBackQueue = [];
    await Promise.allSettled(queue.map((item) => item.persistFn(item.key, item.value)));
    this.emit('flush', { queueSize: queue.length });
  }

  async writeThrough<T = unknown>(
    key: CacheKey,
    value: T,
    persistFn: (key: CacheKey, value: T) => Promise<void>,
    options: { ttl?: number; tags?: string[] } = {}
  ): Promise<void> {
    try {
      await persistFn(key, value);
      this.set(key, value, options);
    } catch (err) {
      this.metrics.errors++;
      throw err;
    }
  }

  invalidateTags(tags: string[]): number {
    let total = 0;
    for (const tag of tags) {
      total += this.deleteByTag(tag);
    }
    return total;
  }

  invalidateAll(): void {
    this.store.clear();
    this.tagIndex.clear();
    this.writeBackQueue = [];
    this.emit('invalidateAll', {});
  }

  evictExpired(): number {
    let count = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > entry.ttl) {
        this.store.delete(key);
        this.removeFromTagIndex(key, entry.tags);
        count++;
      }
    }
    if (count > 0) {
      this.emit('evictExpired', { count });
    }
    return count;
  }

  getMetrics(): CacheMetrics {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      sets: this.metrics.sets,
      deletes: this.metrics.deletes,
      evictions: this.metrics.evictions,
      errors: this.metrics.errors,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
      missRate: total > 0 ? this.metrics.misses / total : 0,
      size: this.store.size,
      maxSize: this.store.max,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      errors: 0,
    };
  }

  keys(): CacheKey[] {
    return Array.from(this.store.keys());
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.invalidateAll();
  }

  on(event: string, listener: (data: unknown) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
    return () => this.eventListeners.get(event)?.delete(listener);
  }

  private emit(event: string, data: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch {
          this.metrics.errors++;
        }
      }
    }
  }

  private addToTagIndex(key: CacheKey, tags: string[]): void {
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    }
  }

  private removeFromTagIndex(key: CacheKey, tags: string[]): void {
    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.writeBackFlushInterval) {
      clearInterval(this.writeBackFlushInterval);
    }
    // Clear all pending write timeouts
    for (const item of this.writeBackQueue) {
      if (item.timeoutId) {
        clearTimeout(item.timeoutId);
      }
    }
    this.invalidateAll();
    this.eventListeners.clear();
  }
}

const defaultCacheEngine = new CacheEngine({
  maxSize: 5000,
  defaultTTL: 300000,
  cleanupIntervalMs: 60000,
  writeBackDelay: 5000,
});

const shortTTLCache = new CacheEngine({
  maxSize: 2000,
  defaultTTL: 60000,
  cleanupIntervalMs: 30000,
});

const longTTLCache = new CacheEngine({
  maxSize: 1000,
  defaultTTL: 3600000,
  cleanupIntervalMs: 300000,
});

export { CacheEngine, defaultCacheEngine, shortTTLCache, longTTLCache };
export type { CacheEntry, CacheMetrics, CacheKey };
