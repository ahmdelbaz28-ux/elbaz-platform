import { CacheEngine, defaultCacheEngine } from '../core/cache-engine';

type PersistFn<K, V> = (key: K, value: V) => Promise<void>;
type FetchFn<K, V> = (key: K) => Promise<V | null>;

class WriteThroughStrategy<K extends string, V> {
  private cache: CacheEngine;
  private persistFn: PersistFn<K, V>;
  private fetchFn: FetchFn<K, V>;
  private keyPrefix: string;
  private ttl: number;
  private tags: string[];

  constructor(options: { cache?: CacheEngine; persistFn: PersistFn<K, V>; fetchFn: FetchFn<K, V>; keyPrefix: string; ttl?: number; tags?: string[] }) {
    this.cache = options.cache ?? defaultCacheEngine;
    this.persistFn = options.persistFn;
    this.fetchFn = options.fetchFn;
    this.keyPrefix = options.keyPrefix;
    this.ttl = options.ttl ?? 300000;
    this.tags = options.tags ?? [];
  }

  private buildKey(key: K): string { return `${this.keyPrefix}:${key}`; }

  async read(key: K): Promise<V | null> {
    const cached = this.cache.get<V>(this.buildKey(key));
    if (cached !== undefined) return cached;
    const value = await this.fetchFn(key);
    if (value !== null) this.cache.set(this.buildKey(key), value, { ttl: this.ttl, tags: this.tags });
    return value;
  }

  async write(key: K, value: V): Promise<void> {
    await this.cache.writeThrough(this.buildKey(key), value, (_k, v) => this.persistFn(key, v as V), { ttl: this.ttl, tags: this.tags });
  }

  async delete(key: K): Promise<void> { this.cache.delete(this.buildKey(key)); }
  invalidateAll(): void { this.cache.invalidateTags(this.tags); }
}

class WriteBackStrategy<K extends string, V> {
  private cache: CacheEngine;
  private persistFn: PersistFn<K, V>;
  private fetchFn: FetchFn<K, V>;
  private keyPrefix: string;
  private ttl: number;
  private tags: string[];
  private writeDelay: number;
  private dirtyKeys: Set<string>;
  private pendingWrites: Map<string, { key: K; value: V; timestamp: number; timeoutId: ReturnType<typeof setTimeout> }>;

  constructor(options: { cache?: CacheEngine; persistFn: PersistFn<K, V>; fetchFn: FetchFn<K, V>; keyPrefix: string; ttl?: number; tags?: string[]; writeDelay?: number }) {
    this.cache = options.cache ?? defaultCacheEngine;
    this.persistFn = options.persistFn;
    this.fetchFn = options.fetchFn;
    this.keyPrefix = options.keyPrefix;
    this.ttl = options.ttl ?? 1800000;
    this.tags = options.tags ?? [];
    this.writeDelay = options.writeDelay ?? 5000;
    this.dirtyKeys = new Set();
    this.pendingWrites = new Map();
  }

  private buildKey(key: K): string { return `${this.keyPrefix}:${key}`; }

  async read(key: K): Promise<V | null> {
    const cacheKey = this.buildKey(key);
    const cached = this.cache.get<V>(cacheKey);
    if (cached !== undefined) return cached;
    const pending = this.pendingWrites.get(cacheKey);
    if (pending) return pending.value;
    const value = await this.fetchFn(key);
    if (value !== null) this.cache.set(cacheKey, value, { ttl: this.ttl, tags: this.tags });
    return value;
  }

  async write(key: K, value: V): Promise<void> {
    const cacheKey = this.buildKey(key);
    this.cache.set(cacheKey, value, { ttl: this.ttl, tags: this.tags });
    this.dirtyKeys.add(cacheKey);

    // Clear any existing pending write for this key
    const existing = this.pendingWrites.get(cacheKey);
    if (existing && existing.timeoutId) {
      clearTimeout(existing.timeoutId);
    }

    const timeoutId = setTimeout(async () => {
      try {
        await this.persistFn(key, value);
        // Only remove from dirty/pending if this is still the latest write
        const current = this.pendingWrites.get(cacheKey);
        if (current && current.timestamp === Date.now()) {
          this.dirtyKeys.delete(cacheKey);
          this.pendingWrites.delete(cacheKey);
        }
      } catch {
        (this.cache as any).metrics.errors++;
      }
    }, this.writeDelay);

    this.pendingWrites.set(cacheKey, { key, value, timestamp: Date.now(), timeoutId });
  }

  async delete(key: K): Promise<void> {
    const cacheKey = this.buildKey(key);
    const pending = this.pendingWrites.get(cacheKey);
    if (pending && pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    this.dirtyKeys.delete(cacheKey);
    this.pendingWrites.delete(cacheKey);
    this.cache.delete(cacheKey);
  }

  async flush(): Promise<void> {
    const keysToFlush = Array.from(this.dirtyKeys);
    const batchSize = 50;
    for (let i = 0; i < keysToFlush.length; i += batchSize) {
      const batch = keysToFlush.slice(i, i + batchSize);
      await Promise.allSettled(batch.map((ck) => {
        const pending = this.pendingWrites.get(ck);
        return pending ? this.persistFn(pending.key, pending.value) : Promise.resolve();
      }));
      for (const ck of batch) {
        const pending = this.pendingWrites.get(ck);
        // Only remove entries where the write is old enough to have been flushed
        // and no new write has been scheduled (timestamp would be newer)
        if (pending && (Date.now() - pending.timestamp >= this.writeDelay)) {
          this.cache.delete(ck);
          this.dirtyKeys.delete(ck);
          this.pendingWrites.delete(ck);
        }
      }
    }
  }

  getDirtyCount(): number { return this.dirtyKeys.size; }
  invalidateAll(): void { this.dirtyKeys.clear(); this.pendingWrites.clear(); this.cache.invalidateTags(this.tags); }
}

class ReadThroughStrategy<K extends string, V> {
  private cache: CacheEngine;
  private fetchFn: FetchFn<K, V>;
  private keyPrefix: string;
  private ttl: number;
  private tags: string[];

  constructor(options: { cache?: CacheEngine; fetchFn: FetchFn<K, V>; keyPrefix: string; ttl?: number; tags?: string[] }) {
    this.cache = options.cache ?? defaultCacheEngine;
    this.fetchFn = options.fetchFn;
    this.keyPrefix = options.keyPrefix;
    this.ttl = options.ttl ?? 300000;
    this.tags = options.tags ?? [];
  }

  private buildKey(key: K): string { return `${this.keyPrefix}:${key}`; }

  async read(key: K): Promise<V> {
    const cached = this.cache.get<V>(this.buildKey(key));
    if (cached !== undefined) return cached;
    const value = await this.fetchFn(key);
    if (value !== null) { this.cache.set(this.buildKey(key), value, { ttl: this.ttl, tags: this.tags }); return value; }
    throw new Error(`ReadThrough: No value found for key ${key}`);
  }

  invalidate(key: K): void { this.cache.delete(this.buildKey(key)); }
  invalidateAll(): void { this.cache.invalidateTags(this.tags); }
}

export { WriteThroughStrategy, WriteBackStrategy, ReadThroughStrategy };
