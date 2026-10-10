import { handle, json } from '@/lib/http';
import { listActivePlans } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({ plans: await listActivePlans() }));
