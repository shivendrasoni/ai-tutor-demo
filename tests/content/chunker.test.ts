import { describe, expect, it } from 'vitest';
import { chunkChapter, estimateTokens } from '@/modules/content/chunker';

const para = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

describe('chunker', () => {
  it('estimateTokens is ceil(chars / 4)', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  it('short chapter is one chunk with its page range', () => {
    const c = chunkChapter([{ page: 3, text: 'Alpha.\n\nBeta.' }, { page: 4, text: 'Gamma.' }]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ ordinal: 0, pageStart: 3, pageEnd: 4 });
  });

  const twelvePages = () =>
    Array.from({ length: 12 }, (_, i) => ({
      page: i + 1,
      text:
        Array.from({ length: 8 }, (_, j) => `Sentence ${i}-${j} ${para(40)}.`).join(' ') +
        '\n\n' +
        'Tail ' + para(60) + '.',
    }));

  it('packs to ~600 tokens, never above 800, overlaps ~80 tokens, ordinals increase', () => {
    const c = chunkChapter(twelvePages(), 10);
    expect(c.length).toBeGreaterThan(2);
    expect(c.every((x) => x.tokenEstimate <= 800)).toBe(true);
    expect(c.every((x) => x.tokenEstimate === estimateTokens(x.text))).toBe(true);
    expect(c.map((x) => x.ordinal)).toEqual(c.map((_, i) => 10 + i));
    for (let i = 0; i + 1 < c.length; i++) {
      const prev = c[i].text;
      const next = c[i + 1].text;
      let found = false;
      for (let len = 200; len <= 320 && !found; len++) {
        const suffix = prev.slice(-len);
        const boundary = len === prev.length || /\s/.test(prev[prev.length - len - 1]);
        if (boundary && !/^\s/.test(suffix) && next.startsWith(suffix)) found = true;
      }
      expect(found).toBe(true);
    }
    expect(c[0].pageStart).toBe(1);
    expect(c.at(-1)!.pageEnd).toBe(12);
  });

  it('page ranges are within the chapter pages and ordered', () => {
    const c = chunkChapter(twelvePages().slice(4, 9));
    for (const x of c) {
      expect(x.pageStart).toBeGreaterThanOrEqual(5);
      expect(x.pageEnd).toBeLessThanOrEqual(9);
      expect(x.pageStart).toBeLessThanOrEqual(x.pageEnd);
    }
    for (let i = 1; i < c.length; i++) {
      expect(c[i].pageStart).toBeGreaterThanOrEqual(c[i - 1].pageStart);
      expect(c[i].pageEnd).toBeGreaterThanOrEqual(c[i - 1].pageEnd);
    }
  });

  it('a 1,000-token paragraph is split on sentences, all chunks <= 800', () => {
    const text = Array.from({ length: 50 }, (_, i) => `This is sentence number ${i} ${para(12)}.`).join(' ');
    const c = chunkChapter([{ page: 1, text }]);
    expect(estimateTokens(text)).toBeGreaterThan(800);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.tokenEstimate <= 800)).toBe(true);
  });

  it('a 10,000-char run with no punctuation or blank lines is hard-split, all chunks <= 800, no word cut in half', () => {
    const text = para(1500);
    const c = chunkChapter([{ page: 1, text }]);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.tokenEstimate <= 800)).toBe(true);
    expect(new Set(c.flatMap((x) => x.text.split(/\s+/))).size).toBe(1500);
  });

  it('an unbroken run with no spaces is still bounded', () => {
    const c = chunkChapter([{ page: 1, text: 'x'.repeat(9000) }]);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.tokenEstimate <= 800)).toBe(true);
  });

  it('a 700-token paragraph followed by another paragraph does not merge into one 1,300-token chunk', () => {
    const big = para(450); // ~2,800 chars = ~700 tokens
    const c = chunkChapter([{ page: 1, text: `${big}\n\n${para(300, 'other')}` }]);
    expect(estimateTokens(big)).toBeGreaterThan(600);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.tokenEstimate <= 800)).toBe(true);
  });

  it('ignores empty and whitespace-only pages; returns [] for a chapter with no text', () => {
    expect(chunkChapter([{ page: 1, text: '  \n ' }])).toEqual([]);
    expect(chunkChapter([])).toEqual([]);
    const c = chunkChapter([{ page: 1, text: ' ' }, { page: 2, text: 'Hello.' }, { page: 3, text: '' }]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ pageStart: 2, pageEnd: 2 });
  });

  it('does not carry overlap across calls (chapter boundary)', () => {
    const a = chunkChapter([{ page: 1, text: 'ONLYINA ' + para(900) }]);
    const b = chunkChapter([{ page: 2, text: 'ONLYINB ' + para(900) }]);
    expect(b.some((x) => x.text.includes('ONLYINA'))).toBe(false);
    expect(a.length).toBeGreaterThan(1);
  });
});
