import { handle, json, requireActor } from '@/lib/http';
import { studentStatus } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => json(await studentStatus(await requireActor(req))));
