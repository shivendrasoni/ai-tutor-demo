import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DomainError } from '@/lib/errors';

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || key.startsWith('/')) {
    throw new DomainError('VALIDATION', 'Invalid blob key');
  }
}

export class LocalBlobStore implements BlobStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const path = resolve(this.dir, key);
    if (!path.startsWith(this.dir + sep)) throw new DomainError('VALIDATION', 'Invalid blob key');
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    const path = this.pathFor(key);
    try {
      return new Uint8Array(await readFile(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new DomainError('NOT_FOUND');
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

export class S3BlobStore implements BlobStore {
  private readonly bucket: string;
  private readonly client: { send(cmd: unknown): Promise<any> };

  constructor(opts: { bucket: string; client: { send(cmd: unknown): Promise<any> } }) {
    this.bucket = opts.bucket;
    this.client = opts.client;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes }));
  }

  async get(key: string): Promise<Uint8Array> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return await res.Body.transformToByteArray();
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') throw new DomainError('NOT_FOUND');
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function selectBlobStore(env: NodeJS.ProcessEnv = process.env): BlobStore {
  if (env.S3_BUCKET) {
    const client = new S3Client({
      region: env.S3_REGION ?? 'us-east-1',
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
    return new S3BlobStore({ bucket: env.S3_BUCKET, client });
  }
  return new LocalBlobStore(env.BLOB_DIR ?? '.data/blobs');
}
