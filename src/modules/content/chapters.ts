import type { OutlineEntry } from './pdf';

export type ChapterSpan = { ordinal: number; title: string; pageStart: number; pageEnd: number };

type Start = { title: string; page: number };

const HEADING = /^(chapter|unit|lesson)\s+(\d+|[ivxlcdm]+)\b/i;
const FIXED_RANGE = 20;

function fromStarts(starts: Start[], total: number): ChapterSpan[] {
  const all: Start[] = starts[0].page > 1 ? [{ title: 'Front matter', page: 1 }, ...starts] : starts;
  return all.map((s, i) => ({
    ordinal: i,
    title: s.title,
    pageStart: s.page,
    pageEnd: i + 1 < all.length ? all[i + 1].page - 1 : total,
  }));
}

function outlineStarts(outline: OutlineEntry[], total: number): Start[] {
  const seen = new Set<number>();
  return outline
    .map((e, idx) => ({ title: e.title.trim(), page: e.page, idx }))
    .filter((e): e is { title: string; page: number; idx: number } =>
      e.title !== '' && e.page !== null && e.page >= 1 && e.page <= total)
    .sort((a, b) => a.page - b.page || a.idx - b.idx)
    .filter((e) => (seen.has(e.page) ? false : (seen.add(e.page), true)))
    .map(({ title, page }) => ({ title, page }));
}

function headingStarts(pages: string[]): Start[] {
  const starts: Start[] = [];
  pages.forEach((text, i) => {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const idx = lines.slice(0, 3).findIndex((l) => HEADING.test(l));
    if (idx === -1) return;
    const next = lines[idx + 1];
    starts.push({
      title: next !== undefined && next.length < 80 ? `${lines[idx]} — ${next}` : lines[idx],
      page: i + 1,
    });
  });
  return starts;
}

export function detectChapters(pages: string[], outline: OutlineEntry[]): ChapterSpan[] {
  const total = pages.length;
  if (total === 0) return [];

  const fromOutline = outlineStarts(outline, total);
  if (fromOutline.length > 0) return fromStarts(fromOutline, total);

  const fromHeadings = headingStarts(pages);
  if (fromHeadings.length > 0) return fromStarts(fromHeadings, total);

  const spans: ChapterSpan[] = [];
  for (let start = 1; start <= total; start += FIXED_RANGE) {
    const end = Math.min(start + FIXED_RANGE - 1, total);
    spans.push({ ordinal: spans.length, title: `Pages ${start}–${end}`, pageStart: start, pageEnd: end });
  }
  return spans;
}
