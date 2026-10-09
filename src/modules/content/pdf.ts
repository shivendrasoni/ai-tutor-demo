import { getDocumentProxy } from 'unpdf';
import { PDFDocument } from 'pdf-lib';

export type OutlineEntry = { title: string; page: number | null };
export type ExtractedPdf = { pageCount: number; outline: OutlineEntry[]; pages: string[] };

type Item = { str: string; transform: number[]; height?: number };

const BLANK_LINE_FACTOR = 1.8;

function pageText(items: Item[]): string {
  let out = '';
  let lastY: number | null = null;
  for (const it of items) {
    const y = it.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 0.5) {
      const lineHeight = it.height || Math.abs(it.transform[3]) || 12;
      out += Math.abs(lastY - y) > BLANK_LINE_FACTOR * lineHeight ? '\n\n' : '\n';
    }
    out += it.str;
    if (it.str !== '' || lastY === null) lastY = y;
  }
  return out.trim();
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  // unpdf transfers/detaches the buffer, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.filter((x) => 'str' in x) as Item[];
      pages.push(pageText(items));
    }
    const outline: OutlineEntry[] = [];
    for (const node of (await pdf.getOutline()) ?? []) {
      let page: number | null = null;
      try {
        const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref !== null && ref !== undefined) {
          page = typeof ref === 'number' ? ref + 1 : (await pdf.getPageIndex(ref)) + 1;
        }
      } catch {
        page = null;
      }
      outline.push({ title: node.title, page });
    }
    return { pageCount: pdf.numPages, outline, pages };
  } finally {
    await pdf.cleanup();
  }
}

export async function splitPage(bytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > src.getPageCount()) {
    throw new Error(`page ${pageNumber} out of range (1-${src.getPageCount()})`);
  }
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [pageNumber - 1]);
  out.addPage(copied);
  return out.save();
}
