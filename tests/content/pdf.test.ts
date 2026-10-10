import { describe, expect, it } from 'vitest';
import { extractPdf, splitPage } from '@/modules/content/pdf';
import { buildPdf, exactText, headingBook, scannedBook, textBook30 } from '../helpers/pdfs';

describe('pdf extraction', () => {
  it('extracts page count, per-page text, and top-level outline', async () => {
    const x = await extractPdf(await textBook30());
    expect(x.pageCount).toBe(30);
    expect(x.pages[0]).toContain('alpha');
    expect(x.pages[10]).toContain('beta');
    expect(x.outline).toEqual([{ title: 'Chapter 1', page: 1 }, { title: 'Chapter 2', page: 11 }, { title: 'Chapter 3', page: 21 }]);
  });
  it('marks an outline entry with no destination as page null', async () => {
    const x = await extractPdf(await buildPdf({ pages: ['a', 'b'], outline: [{ title: 'Ghost', page: null }, { title: 'B', page: 2 }] }));
    expect(x.outline).toEqual([{ title: 'Ghost', page: null }, { title: 'B', page: 2 }]);
  });
  it('keeps line breaks so headings are detectable', async () => {
    const p = (await extractPdf(await headingBook())).pages;
    expect(p[0].split('\n')[0]).toBe('Chapter 1');
    expect(p[0].split('\n')[1]).toBe('Real Numbers');
    expect(p[0].split('\n')[2]).toBe(''); // blank line after heading block
    expect(p[6].split('\n')[0]).toBe('CHAPTER 2');
  });
  it('splitPage yields a one-page pdf with that page text', async () => {
    const one = await extractPdf(await splitPage(await textBook30(), 11));
    expect(one.pageCount).toBe(1);
    expect(one.pages[0]).toContain('beta');
  });
  it('round-trips long wrapped text (whitespace-collapsed) and exact char counts', async () => {
    const t = exactText(1200);
    const x = await extractPdf(await buildPdf({ pages: [t, exactText(200), exactText(199)] }));
    expect(x.pages[0].replace(/\s+/g, ' ')).toBe(t);
    expect(x.pages[1].length).toBe(200);
    expect(x.pages[2].length).toBe(199);
  });
  it('scannedBook has near-empty pages 2-4', async () => {
    const x = await extractPdf(await scannedBook());
    expect(x.pageCount).toBe(6);
    expect(x.pages.map((p) => p.length > 500)).toEqual([true, false, false, false, true, true]);
    expect(x.pages[1]).toBe('.');
  });
  it('resolves a named-destination outline entry', async () => {
    const x = await extractPdf(await buildPdf({ pages: ['a', 'b', 'c'], outline: [{ title: 'Named', page: 3, named: true }, { title: 'Direct', page: 2 }] }));
    expect(x.outline).toEqual([{ title: 'Named', page: 3 }, { title: 'Direct', page: 2 }]);
  });
  it('splitPage rejects out-of-range pages', async () => {
    const bytes = await buildPdf({ pages: ['a', 'b'] });
    await expect(splitPage(bytes, 0)).rejects.toThrow(/out of range/);
    await expect(splitPage(bytes, 3)).rejects.toThrow(/out of range/);
  });
});
