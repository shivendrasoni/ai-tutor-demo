/** Daily cron job: lapses subscriptions whose period ended. Usage: pnpm job:lapse */
import './env';
import { closeDb } from '@/db/client';
import { lapseExpired } from '@/modules/enrollment';

let code = 0;
try {
  const count = await lapseExpired(new Date());
  console.log(JSON.stringify({ lapsed: count }));
} catch (e) {
  console.error(`Error: ${(e as Error)?.message ?? String(e)}`);
  code = 1;
} finally {
  await closeDb();
}
process.exit(code);
