async function purgeCloudflareCache(request: { files?: string[]; tags?: string[] }, token: string, zoneId: string): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (request.files && request.files.length > 0) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: request.files }) });
      if (!r.ok) errors.push(`Files purge: ${r.status}`);
    } catch (e) { errors.push(`Files: ${e instanceof Error ? e.message : 'err'}`); }
  }
  if (request.tags && request.tags.length > 0) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: request.tags }) });
      if (!r.ok) errors.push(`Tags purge: ${r.status}`);
    } catch (e) { errors.push(`Tags: ${e instanceof Error ? e.message : 'err'}`); }
  }
  return { success: errors.length === 0, errors };
}

export { purgeCloudflareCache };
