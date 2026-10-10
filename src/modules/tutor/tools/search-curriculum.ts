import { z } from 'zod';
import type { searchChunks, StudentScope } from '@/modules/content';
import type { CitationTracker } from '../citations';
import type { TutorTool } from '../runner/types';

type Filters = { subjectIds?: string[]; chapterIds?: string[] };

const NO_RESULTS = 'No matching passages found.';

export function createSearchCurriculumTool(a: {
  scope: StudentScope;
  search: typeof searchChunks;
  routed: Filters;
  subjects: { id: string; name: string }[];
  chapters: { id: string; title: string }[];
  tracker: CitationTracker;
}): TutorTool {
  const resolveFilters = (subject?: string, chapter?: string): Filters => {
    const filters: Filters = {};
    if (a.routed.subjectIds?.length) filters.subjectIds = a.routed.subjectIds;
    if (a.routed.chapterIds?.length) filters.chapterIds = a.routed.chapterIds;
    if (filters.subjectIds || filters.chapterIds) return filters; // routed filters take precedence
    const s = subject?.trim().toLowerCase();
    const c = chapter?.trim().toLowerCase();
    const sub = s ? a.subjects.find((x) => x.name.toLowerCase() === s) : undefined;
    const chap = c ? a.chapters.find((x) => x.title.toLowerCase() === c) : undefined;
    if (sub) filters.subjectIds = [sub.id];
    if (chap) filters.chapterIds = [chap.id];
    return filters;
  };

  return {
    name: 'search_curriculum',
    description:
      "Search the student's textbook passages. Call this before answering a question about course content. Optionally narrow by subject or chapter name.",
    inputSchema: z.object({
      query: z.string().describe('What to look up'),
      subject: z.string().optional().describe('Subject name to restrict the search to'),
      chapter: z.string().optional().describe('Chapter title to restrict the search to'),
    }),
    async execute(input: { query?: string; subject?: string; chapter?: string }) {
      const query = typeof input?.query === 'string' ? input.query.trim() : '';
      if (!query) return NO_RESULTS;
      const filters = resolveFilters(input.subject, input.chapter);
      const filtered = Boolean(filters.subjectIds || filters.chapterIds);
      let hits = await a.search(a.scope, query, filters);
      if (hits.length === 0 && filtered) {
        hits = await a.search(a.scope, query, {});
        a.tracker.filterFallback = true;
      }
      if (hits.length === 0) return NO_RESULTS;
      return a.tracker
        .register(hits)
        .map(({ n, hit }) => `[${n}] ${hit.itemTitle} · ${hit.chapterTitle} · p. ${hit.pageStart}–${hit.pageEnd}\n${hit.text}`)
        .join('\n\n');
    },
  };
}
