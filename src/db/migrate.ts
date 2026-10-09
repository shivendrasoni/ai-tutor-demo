import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

config({ quiet: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
try {
  await migrate(drizzle(pool), { migrationsFolder: 'src/db/migrations' });
} finally {
  await pool.end();
}
