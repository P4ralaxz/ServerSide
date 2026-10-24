import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { rmSync } from 'node:fs';

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __PG__?: StartedPostgreSqlContainer }).__PG__?.stop();
  if (process.env.WEB_DIST_DIR) rmSync(process.env.WEB_DIST_DIR, { recursive: true, force: true });
}
