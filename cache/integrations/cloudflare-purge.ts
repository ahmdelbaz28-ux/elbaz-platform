async function purgeOneKind(
  kind: "files" | "tags",
  values: string[],
  token: string,
  zoneId: string,
): Promise<string | null> {
  const label = kind === "files" ? "Files purge" : "Tags purge";
  const errLabel = kind === "files" ? "Files" : "Tags";
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [kind]: values }),
    });
    if (!r.ok) return `${label}: ${r.status}`;
  } catch (e) {
    return `${errLabel}: ${e instanceof Error ? e.message : 'err'}`;
  }
  return null;
}

async function purgeCloudflareCache(request: { files?: string[]; tags?: string[] }, token: string, zoneId: string): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (request.files && request.files.length > 0) {
    const err = await purgeOneKind("files", request.files, token, zoneId);
    if (err) errors.push(err);
  }
  if (request.tags && request.tags.length > 0) {
    const err = await purgeOneKind("tags", request.tags, token, zoneId);
    if (err) errors.push(err);
  }
  return { success: errors.length === 0, errors };
}

export { purgeCloudflareCache };
