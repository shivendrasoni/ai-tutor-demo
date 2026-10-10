import { describe, expect, it } from 'vitest';
import {
  FakeEmbedder,
  OpenAIEmbedder,
  embedInBatches,
  selectEmbedder,
  type Embedder,
} from '@/modules/content/embedder';

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe('FakeEmbedder', () => {
  const e = new FakeEmbedder();

  it('is deterministic, 1536-dim, unit length', async () => {
    const [a] = await e.embed(['Plants make food by photosynthesis']);
    expect(a).toEqual((await e.embed(['plants MAKE food, by photosynthesis!']))[0]);
    expect(a).toHaveLength(1536);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
  });

  it('ranks lexical overlap above unrelated text', async () => {
    const [q, near, far] = await e.embed([
      'photosynthesis in green plants',
      'green plants perform photosynthesis',
      'the french revolution began in 1789',
    ]);
    expect(cos(q, near)).toBeGreaterThan(0.5);
    expect(cos(q, far)).toBeLessThan(0.1);
  });

  it('empty text gives a finite unit vector', async () => {
    const [v] = await e.embed(['']);
    expect(v[0]).toBe(1);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    const [p] = await e.embed(['!!! ???']);
    expect(p).toEqual(v);
  });

  it('exposes model id and dimension', () => {
    expect(e.modelId).toBe('fake:hash-1536');
    expect(e.dimension).toBe(1536);
  });
});

describe('embedInBatches', () => {
  it('never exceeds 96 per call and preserves order', async () => {
    const e = new FakeEmbedder();
    const sizes: number[] = [];
    const spy: Embedder = {
      modelId: e.modelId,
      dimension: 1536,
      embed: async (t) => {
        sizes.push(t.length);
        return e.embed(t);
      },
    };
    const out = await embedInBatches(spy, Array.from({ length: 250 }, (_, i) => `word${i}`));
    expect(sizes).toEqual([96, 96, 58]);
    expect(out).toHaveLength(250);
    expect(out[200]).toEqual((await e.embed(['word200']))[0]);
  });

  it('returns [] for no texts without calling the embedder', async () => {
    const spy: Embedder = {
      modelId: 'x',
      dimension: 1,
      embed: async () => {
        throw new Error('should not be called');
      },
    };
    expect(await embedInBatches(spy, [])).toEqual([]);
  });
});

describe('selectEmbedder', () => {
  it('default fake without key, openai with key, explicit openai without key throws', () => {
    expect(selectEmbedder({} as any)).toBeInstanceOf(FakeEmbedder);
    expect(selectEmbedder({ OPENAI_API_KEY: 'k' } as any)).toBeInstanceOf(OpenAIEmbedder);
    expect(selectEmbedder({ EMBEDDER: 'fake', OPENAI_API_KEY: 'k' } as any)).toBeInstanceOf(
      FakeEmbedder,
    );
    expect(() => selectEmbedder({ EMBEDDER: 'openai' } as any)).toThrow(/OPENAI_API_KEY/);
  });

  it('keyless mock mode uses the fake embedder; an explicit EMBEDDER still wins', () => {
    expect(selectEmbedder({ AI_MOCK: '1' } as any)).toBeInstanceOf(FakeEmbedder);
    expect(selectEmbedder({ AI_MOCK: '1', EMBEDDER: 'openai', OPENAI_API_KEY: 'k' } as any)).toBeInstanceOf(OpenAIEmbedder);
  });

  it('OpenAIEmbedder reports its model id and dimension', () => {
    const o = new OpenAIEmbedder();
    expect(o.modelId).toBe('openai:text-embedding-3-small');
    expect(o.dimension).toBe(1536);
  });
});
