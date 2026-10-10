import type { ChunkHit } from '@/modules/content';

export type Citation = {
  n: number;
  chunkId: string;
  itemTitle: string;
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
};

/** Turn-wide citation numbering: a chunk keeps the same n across every search call in a turn. */
export class CitationTracker {
  filterFallback = false;
  private readonly byChunk = new Map<string, number>();
  private readonly byN = new Map<number, ChunkHit>();

  register(hits: ChunkHit[]): { n: number; hit: ChunkHit }[] {
    return hits.map((hit) => {
      let n = this.byChunk.get(hit.chunkId);
      if (n === undefined) {
        n = this.byChunk.size + 1;
        this.byChunk.set(hit.chunkId, n);
        this.byN.set(n, hit);
      }
      return { n, hit: this.byN.get(n)! };
    });
  }

  get(n: number): ChunkHit | undefined {
    return this.byN.get(n);
  }

  allChunkIds(): string[] {
    return [...this.byChunk.keys()];
  }
}

const CITE_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function parseCitations(text: string, tracker: CitationTracker): Citation[] {
  const seen = new Set<number>();
  const out: Citation[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    for (const part of m[1].split(',')) {
      const n = Number(part.trim());
      if (seen.has(n)) continue;
      const hit = tracker.get(n);
      if (!hit) continue;
      seen.add(n);
      out.push({
        n,
        chunkId: hit.chunkId,
        itemTitle: hit.itemTitle,
        chapterTitle: hit.chapterTitle,
        pageStart: hit.pageStart,
        pageEnd: hit.pageEnd,
      });
    }
  }
  return out;
}
