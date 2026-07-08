/**
 * Start embedded PostgreSQL for local dev (no sudo required).
 * Usage: node scripts/start-local-db.mjs
 * Writes connection info to ../.local/db.env
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const databaseDir = path.join(rootDir, '.local', 'postgres-data');
const port = Number(process.env.LOCAL_PG_PORT || 5432);

await mkdir(path.join(rootDir, '.local'), { recursive: true });

const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
});

await pg.initialise();
await pg.start();

const dbName = 'lead_engine_cre';
try {
    await pg.createDatabase(dbName);
} catch {
    // already exists on re-run
}

const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${dbName}?schema=public`;
await writeFile(
    path.join(rootDir, '.local', 'db.env'),
    `DATABASE_URL="${databaseUrl}"\nLOCAL_PG_PORT=${port}\n`,
);

console.log(`[local-db] PostgreSQL ready on port ${port}`);
console.log(`[local-db] DATABASE_URL=${databaseUrl}`);
console.log('[local-db] Leave this process running while developing.');

process.on('SIGINT', async () => {
    await pg.stop();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await pg.stop();
    process.exit(0);
});
