// Side-effect module: import it FIRST in any entrypoint that builds DB pools at import time (worker, scripts),
// because ESM hoists imports and '@/db/client' reads DATABASE_URL_* when it is evaluated.
// Does not override variables already set (e.g. by vitest from .env.test).
import { config } from 'dotenv';

config({ quiet: true });
