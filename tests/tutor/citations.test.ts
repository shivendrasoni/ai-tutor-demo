import { describe, expect, it } from 'vitest';
import type { ChunkHit } from '@/modules/content';
import { CitationTracker, parseCitations } from '../../src/modules/tutor/citations';

const hit = (id: string): ChunkHit => ({
  chunkId: id,
  contentItemId: 'ci',
  itemTitle: `Book ${id}`,
  subjectId: 's',
  subjectName: 'Math',
  chapterId: 'c',
  chapterTitle: `Chapter ${id}`,
  pageStart: 5,
  pageEnd: 7,
  text: 't',
  similarity: 0.9,
});

function tracker() {
  const t = new CitationTracker();
  t.register([hit('A'), hit('B')]);
  return t;
}

describe('CitationTracker', () => {
  it('numbers from 1, keeps n for repeated chunk ids', () => {
    const t = new CitationTracker();
    expect(t.register([hit('A'), hit('B')]).map((r) => r.n)).toEqual([1, 2]);
    expect(t.register([hit('B'), hit('C')]).map((r) => r.n)).toEqual([2, 3]);
    expect(t.allChunkIds()).toEqual(['A', 'B', 'C']);
    expect(t.get(9)).toBeUndefined();
  });
});

describe('parseCitations', () => {
  it('keeps registered n, drops fabricated, dedupes, orders by first appearance', () => {
    expect(parseCitations('A [2] then [1] and [2] again, fake [7]', tracker()).map((c) => c.n)).toEqual([2, 1]);
  });
  it('handles [1, 2] and ignores [x] and markdown links', () => {
    const t = tracker();
    expect(parseCitations('see [1, 2] and [x] and [link](http://a.b)', t).map((c) => c.n)).toEqual([1, 2]);
    expect(parseCitations('[x] [link](http://a.b)', t)).toEqual([]);
  });
  it('ignores markdown links like [1](http://x) but keeps a plain [1]', () => {
    const t = tracker();
    expect(parseCitations('[1](http://x) and [2](url)', t)).toEqual([]);
    expect(parseCitations('[1](http://x) but also [2] here', t).map((c) => c.n)).toEqual([2]);
    expect(parseCitations('[1](http://x) and [1]', t).map((c) => c.n)).toEqual([1]);
  });
  it('citation carries book, chapter, pages from the hit', () => {
    expect(parseCitations('[1]', tracker())).toEqual([
      { n: 1, chunkId: 'A', itemTitle: 'Book A', chapterTitle: 'Chapter A', pageStart: 5, pageEnd: 7 },
    ]);
  });
});
