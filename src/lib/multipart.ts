import { DomainError } from '@/lib/errors';

const SLACK_BYTES = 1024 * 1024; // multipart envelope and text fields

/**
 * Reads a multipart/form-data upload body. The size is checked from the declared content-length before the
 * body is read; a missing or oversized length is refused. This is separate from `readJson` (100 KB cap).
 */
export async function readUpload(req: Request, maxBytes: number): Promise<FormData> {
  const type = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'multipart/form-data') {
    throw new DomainError('VALIDATION', 'Content-Type must be multipart/form-data');
  }
  const raw = req.headers.get('content-length');
  const declared = raw === null || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes + SLACK_BYTES) {
    throw new DomainError('VALIDATION', 'Upload is too large (max 100 MB)', { field: 'file', reason: 'too_large' });
  }
  try {
    return await req.formData();
  } catch {
    throw new DomainError('VALIDATION', 'Upload could not be read');
  }
}
