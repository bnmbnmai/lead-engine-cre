/**
 * Bootstrap a fresh local database when migrate deploy fails (no baseline migration).
 * Uses prisma db push + optional seed — safe for dev/QA only.
 *
 * Usage: npm run db:bootstrap
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const backendRoot = join(__dirname, '..');

function run(cmd: string) {
    console.log(`\n> ${cmd}`);
    execSync(cmd, { cwd: backendRoot, stdio: 'inherit', env: { ...process.env, TEST_MODE: 'true' } });
}

console.log('[db:bootstrap] Fresh-install database bootstrap (db push, not migrate deploy)');

if (!existsSync(join(backendRoot, '.env'))) {
    console.warn('[db:bootstrap] Warning: backend/.env not found — ensure DATABASE_URL is set');
}

run('npx prisma generate');
run('npx prisma db push');

const seed = process.argv.includes('--no-seed') ? false : true;
if (seed) {
    run('npx ts-node --transpile-only prisma/seed.ts');
    console.log('\n[db:bootstrap] Done — schema pushed and seed data loaded.');
} else {
    console.log('\n[db:bootstrap] Done — schema pushed (seed skipped).');
}
