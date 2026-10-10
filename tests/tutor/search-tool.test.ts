import { describe, expect, it, vi } from 'vitest';
import type { ChunkHit, StudentScope } from '@/modules/content';
import { CitationTracker, parseCitations } from '../../src/modules/tutor/citations';
import { createSearchCurriculumTool } from '../../src/modules/tutor/tools/search-curriculum';

const hit = (id: string): ChunkHit => ({
  chunkId: id,
  contentItemId: 'ci',
  itemTitle: `Book ${id}`,
  subjectId: 's',
  subjectName: 'Math',
  chapterId: 'c',
  chapterTitle: `Chapter ${id}`,
  pageStart: 3,
  pageEnd: 4,
  text: `text ${id}`,
  similarity: 0.9,
});
const scope = {} as StudentScope;
const subjects = [{ id: 'm', name: 'Math' }, { id: 'p', name: 'Physics' }];
const chapters = [{ id: 'c1', title: 'Fractions' }];

function make(search: ReturnType<typeof vi.fn>, routed = {}) {
  const tracker = new CitationTracker();
  const tool = createSearchCurriculumTool({
    scope,
    search: search as never,
    routed,
    subjects,
    chapters,
    tracker,
  });
  return { tool, tracker };
}

describe('search_curriculum tool', () => {
  it('searches with routed filters; no retry when hits exist', async () => {
    const search = vi.fn().mockResolvedValue([hit('a')]);
    const { tool, tracker } = make(search, { subjectIds: ['m'] });
    const out = await tool.execute({ query: 'q' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(scope, 'q', { subjectIds: ['m'] });
    expect(tracker.filterFallback).toBe(false);
    expect(out).toBe('[1] Book a · Chapter a · p. 3–4\ntext a');
  });

  it('retries unfiltered once when the filtered search is empty; sets filterFallback', async () => {
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([hit('x')]);
    const { tool, tracker } = make(search, { subjectIds: ['m'] });
    const out = await tool.execute({ query: 'q' });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][2]).toEqual({});
    expect(tracker.filterFallback).toBe(true);
    expect(out).toContain('[1]');
  });

  it('no retry when no filter was applied and result is empty', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { tool, tracker } = make(search);
    expect(await tool.execute({ query: 'q' })).toBe('No matching passages found.');
    expect(search).toHaveBeenCalledTimes(1);
    expect(tracker.filterFallback).toBe(false);
  });

  it('empty or whitespace query does not call search', async () => {
    const search = vi.fn();
    const { tool } = make(search);
    expect(await tool.execute({ query: '   ' })).toBe('No matching passages found.');
    expect(search).not.toHaveBeenCalled();
  });

  it('maps model-supplied names only when routing gave none; ignores unknown', async () => {
    const search = vi.fn().mockResolvedValue([hit('a')]);
    const { tool } = make(search);
    await tool.execute({ query: 'q', subject: 'physics', chapter: 'FRACTIONS' });
    expect(search.mock.calls[0][1]).toBe('q');
    expect(search.mock.calls[0][2]).toEqual({ subjectIds: ['p'], chapterIds: ['c1'] });
    await tool.execute({ query: 'q', subject: 'Nope' });
    expect(search.mock.calls[1][2]).toEqual({});

    const s2 = vi.fn().mockResolvedValue([hit('a')]);
    const { tool: t2 } = make(s2, { subjectIds: ['m'] });
    await t2.execute({ query: 'q', subject: 'Physics', chapter: 'Fractions' });
    expect(s2.mock.calls[0][2]).toEqual({ subjectIds: ['m'] });
  });

  it('retries unfiltered when model-supplied-name filters give an empty result', async () => {
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([hit('z')]);
    const { tool, tracker } = make(search);
    const out = await tool.execute({ query: 'q', subject: 'Physics' });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][2]).toEqual({ subjectIds: ['p'] });
    expect(search.mock.calls[1][2]).toEqual({});
    expect(tracker.filterFallback).toBe(true);
    expect(out).toContain('[1] Book z');
  });

  it('REVIEW FOCUS 1: numbering is turn-wide and stable across calls and the retried search', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([hit('A'), hit('B')])
      .mockResolvedValueOnce([hit('B'), hit('C')]);
    const { tool, tracker } = make(search, { subjectIds: ['m'] });
    await tool.execute({ query: 'one' });
    const out2 = await tool.execute({ query: 'two' });
    expect(out2).toContain('[2] Book B');
    expect(out2).toContain('[3] Book C');
    expect(tracker.get(1)!.chunkId).toBe('A');
    expect(tracker.get(2)!.chunkId).toBe('B');
    expect(tracker.get(3)!.chunkId).toBe('C');
    expect(tracker.allChunkIds()).toEqual(['A', 'B', 'C']);
    expect(parseCitations('x [4]', tracker)).toEqual([]);
  });
});
