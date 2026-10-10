import { openai } from '@ai-sdk/openai';
import { generateText, type LanguageModel } from 'ai';
import { aiMockMode } from '@/lib/ai-mode';

export interface OcrExtractor {
  extract(page: { pdf: Uint8Array; pageNumber: number }): Promise<string>;
}

export class FakeOcrExtractor implements OcrExtractor {
  readonly calls: number[] = [];

  constructor(private readonly textFor: (pageNumber: number) => string = (n) => `OCR page ${n}`) {}

  async extract(page: { pdf: Uint8Array; pageNumber: number }): Promise<string> {
    this.calls.push(page.pageNumber);
    return this.textFor(page.pageNumber);
  }
}

/** Keyless stand-in: a fixed placeholder so low-text pages still get indexable text. */
export class MockOcrExtractor implements OcrExtractor {
  async extract(page: { pdf: Uint8Array; pageNumber: number }): Promise<string> {
    return `[mock OCR] page ${page.pageNumber}: no text layer; OCR is mocked in this environment.`;
  }
}

function resolveModel(model: LanguageModel | string): LanguageModel {
  if (typeof model !== 'string') return model;
  const slash = model.indexOf('/');
  const provider = slash > 0 ? model.slice(0, slash) : '';
  const id = slash > 0 ? model.slice(slash + 1) : '';
  if (provider === 'openai' && id) return openai(id);
  throw new Error(
    `Unsupported OCR model "${model}": unknown provider "${provider}" (supported: openai/<model>)`,
  );
}

export class ModelOcrExtractor implements OcrExtractor {
  private readonly model: LanguageModel;

  constructor(opts: { model: LanguageModel | string }) {
    this.model = resolveModel(opts.model);
  }

  async extract(page: { pdf: Uint8Array; pageNumber: number }): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe all text on this page exactly. Output the text only.' },
            { type: 'file', data: page.pdf, mediaType: 'application/pdf' },
          ],
        },
      ],
    });
    return text;
  }
}

export function selectOcr(env: NodeJS.ProcessEnv = process.env): OcrExtractor | null {
  if (!env.OCR_MODEL) return aiMockMode(env) ? new MockOcrExtractor() : null;
  return new ModelOcrExtractor({ model: env.OCR_MODEL });
}
