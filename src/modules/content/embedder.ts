import { openai } from '@ai-sdk/openai';
import { embedMany } from 'ai';

export interface Embedder {
  readonly modelId: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

const DIMENSION = 1536;

// Function words carry no topical signal; dropping them keeps unrelated texts near-orthogonal.
const STOPWORDS = new Set(['a', 'an', 'and', 'by', 'in', 'is', 'of', 'on', 'or', 'the', 'to']);

function fnv1a32(bytes: Uint8Array): number {
  let h = 2166136261;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic hashed bag-of-words embedder for tests and keyless dev. */
export class FakeEmbedder implements Embedder {
  readonly modelId = 'fake:hash-1536';
  readonly dimension = DIMENSION;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vector(t));
  }

  private vector(text: string): number[] {
    const v = new Array<number>(DIMENSION).fill(0);
    const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const tok of tokens) {
      if (STOPWORDS.has(tok)) continue;
      v[fnv1a32(new TextEncoder().encode(tok)) % DIMENSION] += 1;
    }
    const norm = Math.hypot(...v);
    if (norm === 0) {
      v[0] = 1;
      return v;
    }
    return v.map((x) => x / norm);
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly modelId = 'openai:text-embedding-3-small';
  readonly dimension = DIMENSION;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const { embeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: texts,
    });
    return embeddings;
  }
}

export function selectEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const choice = env.EMBEDDER ?? (env.OPENAI_API_KEY ? 'openai' : 'fake');
  if (choice === 'fake') return new FakeEmbedder();
  if (choice === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('EMBEDDER=openai requires OPENAI_API_KEY');
    return new OpenAIEmbedder();
  }
  throw new Error(`Unknown EMBEDDER "${choice}"`);
}

export async function embedInBatches(
  e: Embedder,
  texts: string[],
  batchSize = 96,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    out.push(...(await e.embed(texts.slice(i, i + batchSize))));
  }
  return out;
}
