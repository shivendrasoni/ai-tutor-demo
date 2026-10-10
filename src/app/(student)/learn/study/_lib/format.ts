export type Citation = { chunkId: string; itemTitle: string; chapterTitle: string; pageStart: number; pageEnd: number };

/** `Book · Chapter · p. 12–13` (a single page prints as `p. 12`). */
export function formatCitation(c: Citation): string {
  const pages = c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `p. ${c.pageStart}–${c.pageEnd}`;
  return `${c.itemTitle} · ${c.chapterTitle} · ${pages}`;
}
