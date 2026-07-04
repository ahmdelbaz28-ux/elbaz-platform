import { CacheEngine, defaultCacheEngine } from '../core/cache-engine';

type QueryFn<T> = (...args: unknown[]) => Promise<T | null>;

class CacheAsideStrategy<T> {
  private readonly cache: CacheEngine;
  private readonly queryFn: QueryFn<T>;
  private readonly keyBuilder: (...args: unknown[]) => string;
  private readonly ttl: number;
  private readonly tags: string[];
  private readonly staleWhileRevalidate: boolean;
  private readonly maxRetries: number;

  constructor(options: {
    cache?: CacheEngine;
    queryFn: QueryFn<T>;
    keyBuilder: (...args: unknown[]) => string;
    ttl?: number;
    tags?: string[];
    staleWhileRevalidate?: boolean;
    maxRetries?: number;
  }) {
    this.cache = options.cache ?? defaultCacheEngine;
    this.queryFn = options.queryFn;
    this.keyBuilder = options.keyBuilder;
    this.ttl = options.ttl ?? 300000;
    this.tags = options.tags ?? [];
    this.staleWhileRevalidate = options.staleWhileRevalidate ?? false;
    this.maxRetries = options.maxRetries ?? 1;
  }

  async get(...args: unknown[]): Promise<T | null> {
    const cacheKey = this.keyBuilder(...args);
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== undefined) return cached;
    return this.fetchAndCache(cacheKey, ...args);
  }

  async getMany(keys: Array<{ args: unknown[]; key?: string }>): Promise<(T | null)[]> {
    const results: (T | null)[] = [];
    const missedIndices: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      const cacheKey = keys[i].key ?? this.keyBuilder(...keys[i].args);
      const cached = this.cache.get<T>(cacheKey);
      if (cached === undefined) { results[i] = null; missedIndices.push(i); }
      else { results[i] = cached; }
    }
    await Promise.all(missedIndices.map(async (i) => {
      const cacheKey = keys[i].key ?? this.keyBuilder(...keys[i].args);
      results[i] = await this.fetchAndCache(cacheKey, ...keys[i].args);
    }));
    return results;
  }

  async invalidate(...args: unknown[]): Promise<boolean> {
    return this.cache.delete(this.keyBuilder(...args));
  }

  invalidateByTags(tags?: string[]): number {
    return this.cache.invalidateTags(tags ?? this.tags);
  }

  /**
   * If SWR is enabled and a stale cache entry exists, schedule a background
   * refresh and return the stale entry. Returns undefined otherwise.
   */
  private maybeServeStale(cacheKey: string, ...args: unknown[]): T | undefined {
    if (!this.staleWhileRevalidate) return undefined;
    const staleEntry = this.cache.get<T>(cacheKey);
    if (staleEntry === undefined) return undefined;
    Promise.resolve(this.queryFn(...args)).then((fresh) => {
      if (fresh !== null && fresh !== undefined) this.cache.set(cacheKey, fresh, { ttl: this.ttl, tags: this.tags });
    }).catch(() => {});
    return staleEntry;
  }

  /**
   * Decide what to do after a fetch attempt failed: serve stale (on first
   * retry only), rethrow if we've exhausted retries, or return undefined to
   * signal "try again". Extracted from fetchWithRetry to keep cognitive
   * complexity manageable.
   *
   * Returns `T | undefined` if the caller should keep retrying (with the
   * stale value if applicable), or throws `error` if retries are exhausted.
   */
  private handleRetryFailure(cacheKey: string, args: unknown[], retries: number, error: unknown): T | undefined {
    if (retries === 1) {
      const stale = this.maybeServeStale(cacheKey, ...args);
      if (stale !== undefined) return stale;
    }
    if (retries > this.maxRetries) throw error;
    return undefined;
  }

  private async fetchWithRetry(cacheKey: string, ...args: unknown[]): Promise<T | null> {
    let retries = 0;
    while (retries <= this.maxRetries) {
      try {
        const result = await this.queryFn(...args);
        if (result !== null && result !== undefined) {
          this.cache.set(cacheKey, result, { ttl: this.ttl, tags: this.tags });
        }
        return result;
      } catch (error) {
        retries++;
        const fallback = this.handleRetryFailure(cacheKey, args, retries, error);
        if (fallback !== undefined) return fallback;
        await new Promise((r) => setTimeout(r, Math.min(100 * Math.pow(2, retries), 1000)));
      }
    }
    return null;
  }

  private async fetchAndCache(cacheKey: string, ...args: unknown[]): Promise<T | null> {
    return this.fetchWithRetry(cacheKey, ...args);
  }
}

class DatabaseCacheManager {
  private readonly cache: CacheEngine;
  private readonly queryCache: Map<string, CacheAsideStrategy<unknown>>;

  constructor(cache?: CacheEngine) {
    this.cache = cache ?? defaultCacheEngine;
    this.queryCache = new Map();
  }

  registerQuery<T>(queryName: string, options: {
    queryFn: QueryFn<T>;
    keyBuilder: (...args: unknown[]) => string;
    ttl?: number;
    tags?: string[];
    staleWhileRevalidate?: boolean;
  }): CacheAsideStrategy<T> {
    const strategy = new CacheAsideStrategy<T>({ cache: this.cache, ...options });
    this.queryCache.set(queryName, strategy as CacheAsideStrategy<unknown>);
    return strategy;
  }

  getQuery<T>(queryName: string): CacheAsideStrategy<T> | undefined {
    return this.queryCache.get(queryName) as CacheAsideStrategy<T> | undefined;
  }

  invalidateByTags(tags: string[]): number { return this.cache.invalidateTags(tags); }
  getMetrics() { return this.cache.getMetrics(); }
}

const dbCacheManager = new DatabaseCacheManager();
export { CacheAsideStrategy, DatabaseCacheManager, dbCacheManager };
