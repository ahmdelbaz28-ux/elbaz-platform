import { defaultCacheEngine, shortTTLCache, longTTLCache } from '../core/cache-engine';
import type { CacheMetrics } from '../core/cache-engine';

interface MetricsSnapshot { timestamp: number; default: CacheMetrics; short: CacheMetrics; long: CacheMetrics; }
interface AlertRule { name: string; condition: (m: AggregatedMetrics) => boolean; cooldown: number; lastTriggered: number; severity: 'info' | 'warning' | 'critical'; }
interface AggregatedMetrics { default: CacheMetrics; short: CacheMetrics; long: CacheMetrics; totalHits: number; totalMisses: number; totalErrors: number; totalEvictions: number; overallHitRate: number; overallSize: number; snapshots: MetricsSnapshot[]; }

class CacheMonitor {
  private snapshots: MetricsSnapshot[] = [];
  private maxSnapshots: number;
  private snapshotInterval: ReturnType<typeof setInterval> | null;
  private alertRules: AlertRule[];
  private alertCallbacks: Array<(rule: AlertRule, metrics: AggregatedMetrics) => void>;
  private enabled: boolean;

  constructor(options: { maxSnapshots?: number; snapshotIntervalMs?: number } = {}) {
    this.maxSnapshots = options.maxSnapshots ?? 1440;
    this.alertRules = [];
    this.alertCallbacks = [];
    this.enabled = true;
    this.snapshotInterval = setInterval(() => this.takeSnapshot(), options.snapshotIntervalMs ?? 60000);
  }

  takeSnapshot(): MetricsSnapshot {
    const s: MetricsSnapshot = { timestamp: Date.now(), default: defaultCacheEngine.getMetrics(), short: shortTTLCache.getMetrics(), long: longTTLCache.getMetrics() };
    this.snapshots.push(s);
    if (this.snapshots.length > this.maxSnapshots) this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    this.evaluateAlerts();
    return s;
  }

  getAggregatedMetrics(): AggregatedMetrics {
    const d = defaultCacheEngine.getMetrics(), s = shortTTLCache.getMetrics(), l = longTTLCache.getMetrics();
    const th = d.hits + s.hits + l.hits, tm = d.misses + s.misses + l.misses, to = th + tm;
    return { default: d, short: s, long: l, totalHits: th, totalMisses: tm, totalErrors: d.errors + s.errors + l.errors, totalEvictions: d.evictions + s.evictions + l.evictions, overallHitRate: to > 0 ? th / to : 0, overallSize: d.size + s.size + l.size, snapshots: [...this.snapshots] };
  }

  addAlertRule(rule: Omit<AlertRule, 'lastTriggered'>): void { this.alertRules.push({ ...rule, lastTriggered: 0 }); }
  onAlert(cb: (rule: AlertRule, m: AggregatedMetrics) => void): () => void { this.alertCallbacks.push(cb); return () => { const i = this.alertCallbacks.indexOf(cb); if (i > -1) this.alertCallbacks.splice(i, 1); }; }

  private evaluateAlerts(): void {
    if (!this.enabled) return;
    const m = this.getAggregatedMetrics(), now = Date.now();
    for (const rule of this.alertRules) {
      if (now - rule.lastTriggered < rule.cooldown) continue;
      if (rule.condition(m)) { rule.lastTriggered = now; for (const cb of this.alertCallbacks) { try { cb(rule, m); } catch {} } }
    }
  }

  getReport(): string {
    const m = this.getAggregatedMetrics();
    return [
      '=== ELBAZ PLATFORM CACHE MONITOR ===', `Timestamp: ${new Date().toISOString()}`, '',
      '--- DEFAULT CACHE ---', `  Size: ${m.default.size}/${m.default.maxSize}`, `  Hit Rate: ${(m.default.hitRate * 100).toFixed(2)}%`, `  Hits: ${m.default.hits} | Misses: ${m.default.misses}`, `  Evictions: ${m.default.evictions} | Errors: ${m.default.errors}`, '',
      '--- SHORT TTL ---', `  Size: ${m.short.size}/${m.short.maxSize}`, `  Hit Rate: ${(m.short.hitRate * 100).toFixed(2)}%`, '',
      '--- LONG TTL ---', `  Size: ${m.long.size}/${m.long.maxSize}`, `  Hit Rate: ${(m.long.hitRate * 100).toFixed(2)}%`, '',
      '--- AGGREGATE ---', `  Overall Hit Rate: ${(m.overallHitRate * 100).toFixed(2)}%`, `  Total Entries: ${m.overallSize}`, `  Errors: ${m.totalErrors}`, `  Evictions: ${m.totalEvictions}`,
    ].join('\n');
  }

  resetAllMetrics(): void { defaultCacheEngine.resetMetrics(); shortTTLCache.resetMetrics(); longTTLCache.resetMetrics(); this.snapshots = []; }
  destroy(): void { if (this.snapshotInterval) clearInterval(this.snapshotInterval); this.alertCallbacks = []; }
}

const cacheMonitor = new CacheMonitor();
cacheMonitor.addAlertRule({ name: 'LowHitRate', condition: (m) => m.overallHitRate < 0.5, cooldown: 300000, severity: 'warning' });
cacheMonitor.addAlertRule({ name: 'HighEvictionRate', condition: (m) => m.totalEvictions > 1000, cooldown: 300000, severity: 'warning' });
cacheMonitor.addAlertRule({ name: 'CacheFull', condition: (m) => m.overallSize > 8000, cooldown: 60000, severity: 'critical' });
cacheMonitor.addAlertRule({ name: 'HighErrorRate', condition: (m) => m.totalErrors > 100, cooldown: 60000, severity: 'critical' });

export { CacheMonitor, cacheMonitor };
export type { MetricsSnapshot, AggregatedMetrics, AlertRule };
