import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { FakeOcrExtractor, ModelOcrExtractor, selectOcr } from '@/modules/content/ocr';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

describe('ModelOcrExtractor', () => {
  it('sends the single-page PDF as a file part and returns the text', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'scanned text' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }),
    });
    const text = await new ModelOcrExtractor({ model }).extract({
      pdf: new Uint8Array([37, 80, 68, 70]),
      pageNumber: 2,
    });
    expect(text).toBe('scanned text');
    const part = model.doGenerateCalls[0].prompt
      .flatMap((m: any) => m.content)
      .find((p: any) => p.type === 'file');
    expect(part.mediaType).toBe('application/pdf');
  });

  it('rejects unknown providers at construction', () => {
    expect(() => new ModelOcrExtractor({ model: 'acme/ocr-1' })).toThrow(/provider/i);
    expect(() => new ModelOcrExtractor({ model: 'noslash' })).toThrow(/provider/i);
  });
});

describe('FakeOcrExtractor', () => {
  it('records the pages it was asked for', async () => {
    const ocr = new FakeOcrExtractor((n) => `page ${n}`);
    const pdf = new Uint8Array();
    expect(await ocr.extract({ pdf, pageNumber: 3 })).toBe('page 3');
    await ocr.extract({ pdf, pageNumber: 1 });
    expect(ocr.calls).toEqual([3, 1]);
  });
});

describe('selectOcr', () => {
  it('returns null without OCR_MODEL', () => expect(selectOcr({} as any)).toBeNull());
  it('returns a ModelOcrExtractor with OCR_MODEL', () => {
    expect(selectOcr({ OCR_MODEL: 'openai/gpt-4o-mini', OPENAI_API_KEY: 'k' } as any)).toBeInstanceOf(
      ModelOcrExtractor,
    );
  });
});
