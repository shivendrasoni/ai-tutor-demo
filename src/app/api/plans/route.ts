import { handle, json } from '@/lib/http';
import { listActivePlans } from '@/modules/enrollment';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const plans = await listActivePlans();
  return json({
    plans: plans.map((p) => ({ id: p.id, name: p.name, interval: p.interval, priceMinor: p.priceMinor, currency: p.currency })),
  });
});
