export const TARGET_TOKENS = 600;
export const OVERLAP_TOKENS = 80;

const TARGET_CHARS = TARGET_TOKENS * 4;
const OVERLAP_CHARS = OVERLAP_TOKENS * 4;

export type ChunkDraft = {
  ordinal: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  tokenEstimate: number;
};

type Unit = { text: string; page: number };

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split text at the last space before `max` chars; a run with no space is cut at `max`. */
function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > 0 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Break one paragraph into pieces of at most TARGET_CHARS: sentences first, hard split as fallback. */
function splitParagraph(paragraph: string): string[] {
  if (paragraph.length <= TARGET_CHARS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+/).flatMap((s) => hardSplit(s, TARGET_CHARS));
  const pieces: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > TARGET_CHARS) {
      pieces.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/** Last ~OVERLAP_CHARS of the units, cut at a word boundary, with the pages they came from. */
function overlapOf(units: Unit[]): { text: string; pages: number[] } | null {
  const body = units.map((u) => u.text).join('\n\n');
  if (!body) return null;
  let text = body;
  if (body.length > OVERLAP_CHARS) {
    text = body.slice(-OVERLAP_CHARS);
    if (!/\s/.test(body[body.length - OVERLAP_CHARS - 1])) {
      const ws = text.search(/\s/);
      text = ws < 0 ? '' : text.slice(ws);
    }
    text = text.trimStart();
  }
  if (!text) return null;
  const pages: number[] = [];
  let covered = 0;
  for (let i = units.length - 1; i >= 0 && covered < text.length; i--) {
    pages.push(units[i].page);
    covered += units[i].text.length + 2;
  }
  return { text, pages };
}

export function chunkChapter(pages: { page: number; text: string }[], startOrdinal = 0): ChunkDraft[] {
  const units: Unit[] = [];
  for (const p of pages) {
    for (const para of p.text.split(/\n\s*\n/)) {
      const t = para.trim();
      if (!t) continue;
      for (const piece of splitParagraph(t)) units.push({ text: piece, page: p.page });
    }
  }

  const groups: Unit[][] = [];
  let cur: Unit[] = [];
  let curLen = 0;
  for (const u of units) {
    if (cur.length && curLen + 2 + u.text.length > TARGET_CHARS) {
      groups.push(cur);
      cur = [];
      curLen = 0;
    }
    curLen += (cur.length ? 2 : 0) + u.text.length;
    cur.push(u);
  }
  if (cur.length) groups.push(cur);

  return groups.map((group, i) => {
    const overlap = i > 0 ? overlapOf(groups[i - 1]) : null;
    const body = group.map((u) => u.text).join('\n\n');
    const text = overlap ? `${overlap.text} ${body}` : body;
    const allPages = [...group.map((u) => u.page), ...(overlap?.pages ?? [])];
    return {
      ordinal: startOrdinal + i,
      text,
      pageStart: Math.min(...allPages),
      pageEnd: Math.max(...allPages),
      tokenEstimate: estimateTokens(text),
    };
  });
}
