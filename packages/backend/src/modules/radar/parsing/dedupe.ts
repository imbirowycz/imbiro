// Deduplication inside the current result only (nothing is remembered between runs).

/**
 * Keeps the first item for every key. An item is a duplicate if ANY of its keys was seen
 * before — e.g. same GUID with a different URL, or same URL under a different GUID.
 */
export function dedupeBy<T>(items: readonly T[], keysOf: (item: T) => Array<string | null | undefined>): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const keys = keysOf(item).filter((key): key is string => !!key)
    if (keys.some((key) => seen.has(key))) continue
    for (const key of keys) seen.add(key)
    unique.push(item)
  }
  return unique
}

/** Normalized title used as an additional key: catches the same story under two URLs of one source. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function dedupeNews<T extends { id: string; url: string; title: string; source: string }>(items: readonly T[]): T[] {
  return dedupeBy(items, (item) => [`url:${item.url}`, `id:${item.source}:${item.id}`, `title:${item.source}:${titleKey(item.title)}`])
}
