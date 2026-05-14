import ElbazCache from './index';

async function warmUpEssentialData(): Promise<void> {
  ElbazCache.engine.set('config:platform_name', 'Elbaz Platform', { ttl: ElbazCache.ttl.DAY, tags: [ElbazCache.tags.CONFIG_ALL] });
  ElbazCache.engine.set('config:platform_version', '1.0.0', { ttl: ElbazCache.ttl.DAY, tags: [ElbazCache.tags.CONFIG_ALL] });
  ElbazCache.engine.set('config:features', JSON.stringify({ videoStreaming: true, quizzes: true, certificates: true, payments: true, analytics: true }), { ttl: ElbazCache.ttl.VERY_LONG, tags: [ElbazCache.tags.CONFIG_ALL] });
  console.log('Cache warm-up complete');
}

async function initCache(): Promise<void> {
  console.log('Initializing Elbaz Platform Cache Layer...');
  ElbazCache.monitor.onAlert((rule: any, metrics: any) => {
    console.warn(`[CACHE ALERT] ${rule.severity.toUpperCase()}: ${rule.name}`, { hitRate: `${(metrics.overallHitRate * 100).toFixed(2)}%`, size: metrics.overallSize });
  });
  await warmUpEssentialData();
  console.log(ElbazCache.monitor.getReport());
}

export { initCache, warmUpEssentialData };
