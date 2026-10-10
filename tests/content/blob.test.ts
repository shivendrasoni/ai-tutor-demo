import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalBlobStore, S3BlobStore, selectBlobStore, type BlobStore } from '@/modules/content/blob';

const dirs: string[] = [];

function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const commands: unknown[] = [];
  const client = {
    async send(cmd: any) {
      commands.push(cmd);
      const { Key } = cmd.input;
      switch (cmd.constructor.name) {
        case 'PutObjectCommand':
          objects.set(Key, cmd.input.Body);
          return {};
        case 'GetObjectCommand': {
          const body = objects.get(Key);
          if (!body) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
          return { Body: { transformToByteArray: async () => body } };
        }
        case 'DeleteObjectCommand':
          objects.delete(Key);
          return {};
        default:
          throw new Error('unexpected command');
      }
    },
  };
  return { client, commands };
}

async function make(kind: string): Promise<BlobStore> {
  if (kind === 'local') {
    const dir = await mkdtemp(join(tmpdir(), 'blob-'));
    dirs.push(dir);
    return new LocalBlobStore(dir);
  }
  return new S3BlobStore({ bucket: 'b', client: fakeS3().client });
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('BlobStore', () => {
  it.each(['local', 's3'])('%s round-trips bytes and deletes', async (kind) => {
    const store = await make(kind);
    await store.put('s1/i1.pdf', new Uint8Array([1, 2, 3]));
    expect(Array.from(await store.get('s1/i1.pdf'))).toEqual([1, 2, 3]);
    await store.delete('s1/i1.pdf');
    await expect(store.get('s1/i1.pdf')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.delete('s1/i1.pdf')).resolves.toBeUndefined();
  });

  it.each(['local', 's3'])('%s rejects unsafe keys', async (kind) => {
    const store = await make(kind);
    await expect(store.put('../x.pdf', new Uint8Array())).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.get('a/../x.pdf')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.delete('/abs.pdf')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('S3 sends the bucket and key with each command', async () => {
    const { client, commands } = fakeS3();
    const store = new S3BlobStore({ bucket: 'my-bucket', client });
    await store.put('k.bin', new Uint8Array([9]));
    expect((commands[0] as any).input).toMatchObject({ Bucket: 'my-bucket', Key: 'k.bin' });
  });

  it('selects S3 only when S3_BUCKET is set, local default dir otherwise', () => {
    expect(selectBlobStore({ S3_BUCKET: 'b' } as any)).toBeInstanceOf(S3BlobStore);
    expect(selectBlobStore({} as any)).toBeInstanceOf(LocalBlobStore);
  });

  it('local default dir is .data/blobs', () => {
    const store = selectBlobStore({} as any) as any;
    expect(store.dir).toMatch(/\.data[\\/]blobs$/);
  });
});
