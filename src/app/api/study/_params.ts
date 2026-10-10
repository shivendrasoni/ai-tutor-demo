import { z } from 'zod';
import { DomainError } from '@/lib/errors';

const uuid = z.uuid();

/** Awaits the route `params` and returns `id`; anything that is not a UUID is a 404 (never a 500 from the database). */
export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) throw new DomainError('NOT_FOUND');
  return id;
}

export type IdCtx = { params: Promise<{ id: string }> };
