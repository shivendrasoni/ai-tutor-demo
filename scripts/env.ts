// Imported first by CLI scripts so DATABASE_URL_* are set before '@/db/client' builds its pools.
// Does not override variables already set (e.g. by vitest from .env.test).
import { config } from 'dotenv';

config({ quiet: true });
