import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts } from 'pdf-lib';

const SIZE = 11;
const LINE = 14;
const MARGIN = 50;
const WIDTH = 612;

export type BuildPdfOpts = {
  pages: string[];
  outline?: { title: string; page: number | null }[];
};

/**
 * Builds a PDF with Helvetica text. Each page string is split on '\n'; a '\n\n' yields one blank
 * line. Lines longer than the page width are word-wrapped (wrapping replaces a space with a line
 * break, so whitespace-collapsed extracted text equals the whitespace-collapsed input).
 * `outline` builds a flat /Outlines tree via the low-level context; `page: null` omits /Dest.
 */
export async function buildPdf(opts: BuildPdfOpts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedStandardFont(StandardFonts.Helvetica);
  const maxW = WIDTH - 2 * MARGIN;

  for (const text of opts.pages) {
    const lines: string[] = [];
    for (const raw of text.split('\n')) {
      if (raw.trim() === '') { lines.push(''); continue; }
      let cur = '';
      for (const word of raw.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && font.widthOfTextAtSize(next, SIZE) > maxW) { lines.push(cur); cur = word; } else cur = next;
      }
      if (cur) lines.push(cur);
    }
    const height = Math.max(792, lines.length * LINE + 2 * MARGIN);
    const page = doc.addPage([WIDTH, height]);
    let y = height - MARGIN;
    for (const line of lines) {
      if (line) page.drawText(line, { x: MARGIN, y, size: SIZE, font });
      y -= LINE;
    }
  }

  if (opts.outline?.length) {
    const ctx = doc.context;
    const pageRefs = doc.getPages().map((p) => p.ref);
    const rootRef = ctx.nextRef();
    const itemRefs: PDFRef[] = opts.outline.map(() => ctx.nextRef());
    opts.outline.forEach((o, i) => {
      const d = ctx.obj({ Title: PDFString.of(o.title), Parent: rootRef }) as PDFDict;
      if (o.page !== null) d.set(PDFName.of('Dest'), ctx.obj([pageRefs[o.page - 1], PDFName.of('Fit')]) as PDFArray);
      if (i > 0) d.set(PDFName.of('Prev'), itemRefs[i - 1]);
      if (i < itemRefs.length - 1) d.set(PDFName.of('Next'), itemRefs[i + 1]);
      ctx.assign(itemRefs[i], d);
    });
    ctx.assign(rootRef, ctx.obj({
      Type: 'Outlines', First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: PDFNumber.of(itemRefs.length),
    }));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
  }
  return doc.save();
}

/**
 * Text of exactly `n` characters (single-spaced words, no leading/trailing space), so a page built
 * from it extracts to a string whose length is exactly `n` (wrapping swaps ' ' for '\n', same length).
 * e.g. buildPdf({ pages: [exactText(200)] }) -> page with exactly 200 chars; exactText(199) -> 199.
 */
export function exactText(n: number, seed = 'lorem'): string {
  const words = [seed, 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];
  let s = '';
  for (let i = 0; s.length < n; i++) s += (s ? ' ' : '') + words[i % words.length];
  s = s.slice(0, n).trimEnd();
  while (s.length < n) s += 'x';
  return s;
}

const MARKERS = ['alpha', 'beta', 'gamma'];

export async function textBook30(): Promise<Uint8Array> {
  const pages = Array.from({ length: 30 }, (_, i) => {
    const marker = MARKERS[Math.floor(i / 10)];
    return `Page ${i + 1} ${marker}\n${exactText(1200, marker)}`;
  });
  return buildPdf({
    pages,
    outline: [1, 11, 21].map((p, i) => ({ title: `Chapter ${i + 1}`, page: p })),
  });
}

export async function headingBook(): Promise<Uint8Array> {
  const pages = Array.from({ length: 12 }, (_, i) => {
    if (i === 0) return `Chapter 1\nReal Numbers\n\n${exactText(600)}`;
    if (i === 6) return `CHAPTER 2\nPolynomials\n\n${exactText(600)}`;
    return exactText(600);
  });
  return buildPdf({ pages });
}

export async function scannedBook(): Promise<Uint8Array> {
  return buildPdf({
    pages: [exactText(1000), '.', '.', '.', exactText(1000), exactText(1000)],
  });
}
