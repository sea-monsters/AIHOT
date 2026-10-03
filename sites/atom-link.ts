// Adapted from upstream #63: XML Base inherits document → feed → entry → link.
// This resolves metadata only; it does not fetch the linked page or broaden fetch permissions.
function resolveHttp(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Unsafe feed link');
  return url.href;
}

export function atomLink(feed: any, entry: any, documentUrl: string): string | null {
  try {
    const links = entry.link == null ? [] : Array.isArray(entry.link) ? entry.link : [entry.link];
    const link = links.find((item: any) => item && typeof item === 'object' && (!item['@rel'] || item['@rel'] === 'alternate')) ?? links[0];
    const href = typeof link === 'string' ? link : link?.['@href'];
    if (typeof href !== 'string' || !href.trim()) return null;
    let base = resolveHttp(documentUrl);
    for (const node of [feed, entry, typeof link === 'object' ? link : null]) {
      const value = node?.['@xml:base'];
      if (value !== undefined) {
        if (typeof value !== 'string') return null;
        base = resolveHttp(value, base);
      }
    }
    return resolveHttp(href, base);
  } catch { return null; }
}
