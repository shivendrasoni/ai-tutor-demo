import { describe, it, expect } from 'vitest';
import { detectChapters } from '@/modules/content/chapters';

const pages = (n: number) => Array.from({ length: n }, (_, i) => `text ${i + 1}`);

describe('detectChapters', () => {
  it('method 1: outline spans run to the page before the next entry; last runs to the end', () => {
    expect(detectChapters(pages(30), [{ title: 'Ch A', page: 1 }, { title: 'Ch B', page: 11 }, { title: 'Ch C', page: 21 }]))
      .toEqual([
        { ordinal: 0, title: 'Ch A', pageStart: 1, pageEnd: 10 },
        { ordinal: 1, title: 'Ch B', pageStart: 11, pageEnd: 20 },
        { ordinal: 2, title: 'Ch C', pageStart: 21, pageEnd: 30 },
      ]);
  });
  it('outline starting after page 1 adds Front matter', () => {
    const r = detectChapters(pages(10), [{ title: 'One', page: 3 }]);
    expect(r[0]).toEqual({ ordinal: 0, title: 'Front matter', pageStart: 1, pageEnd: 2 });
    expect(r[1]).toMatchObject({ title: 'One', pageStart: 3, pageEnd: 10 });
  });
  it('ignores unresolved, out-of-range, and duplicate-page outline entries; sorts by page', () => {
    const r = detectChapters(pages(20), [
      { title: 'Ghost', page: null }, { title: 'B', page: 9 }, { title: 'A', page: 1 },
      { title: 'B dup', page: 9 }, { title: 'Beyond', page: 99 }, { title: 'Zero', page: 0 },
    ]);
    expect(r.map((c) => [c.title, c.pageStart, c.pageEnd])).toEqual([['A', 1, 8], ['B', 9, 20]]);
  });
  it('ignores outline entries with an empty trimmed title and trims titles', () => {
    const r = detectChapters(pages(6), [{ title: '   ', page: 1 }, { title: ' X ', page: 2 }]);
    expect(r.map((c) => [c.title, c.pageStart, c.pageEnd])).toEqual([['Front matter', 1, 1], ['X', 2, 6]]);
  });
  it('an outline with no usable entries falls through to the heading heuristic', () => {
    const p = pages(10); p[0] = 'Chapter 1\nReal Numbers\nbody'; p[5] = 'intro line\nUnit IV\nbody';
    expect(detectChapters(p, [{ title: 'Ghost', page: null }]).map((c) => c.title)).toEqual(['Chapter 1 — Real Numbers', 'Unit IV — body']);
  });
  it('method 2: heading in the first 3 non-empty lines; title adds next line only if < 80 chars', () => {
    const p = pages(8); p[0] = '\n\nlesson 2\n' + 'x'.repeat(80); p[4] = 'a\nb\nCHAPTER XII\nShort title';
    expect(detectChapters(p, []).map((c) => [c.title, c.pageStart])).toEqual([['lesson 2', 1], ['CHAPTER XII — Short title', 5]]);
  });
  it('a heading on the 4th line or a mid-sentence "chapter 3" is not a chapter', () => {
    const p = pages(5); p[2] = 'a\nb\nc\nChapter 3'; p[3] = 'as we saw in chapter 3 earlier';
    expect(detectChapters(p, []).map((c) => c.title)).toEqual(['Pages 1–5']);
  });
  it('method 2 with first heading on page 4 adds Front matter 1–3', () => {
    const p = pages(6); p[3] = 'Chapter 1\nIntro';
    expect(detectChapters(p, []).map((c) => [c.title, c.pageStart, c.pageEnd])).toEqual([['Front matter', 1, 3], ['Chapter 1 — Intro', 4, 6]]);
  });
  it('method 3: fixed 20-page ranges', () => {
    expect(detectChapters(pages(45), []).map((c) => [c.title, c.pageStart, c.pageEnd]))
      .toEqual([['Pages 1–20', 1, 20], ['Pages 21–40', 21, 40], ['Pages 41–45', 41, 45]]);
  });
  it('a single-page document yields one span', () => {
    expect(detectChapters(pages(1), [])).toEqual([{ ordinal: 0, title: 'Pages 1–1', pageStart: 1, pageEnd: 1 }]);
  });
  it('zero pages yields no spans', () => expect(detectChapters([], [])).toEqual([]));
});
