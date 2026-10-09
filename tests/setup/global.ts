import { config } from 'dotenv';

export async function setup() {
  config({ path: '.env.test', override: true, quiet: true });
  // Migrations run here once the schema exists (Task 2); no-op until then.
}

export async function teardown() {
  const { closeDb } = await import('../../src/db/client');
  await closeDb();
}
