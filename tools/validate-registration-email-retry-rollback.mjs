// Local-only, transactional verification. Never connects to a linked/cloud project.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--without-correction')) {
  throw new Error('Usage: node tools/validate-registration-email-retry-rollback.mjs [--without-correction]');
}
const root = resolve(import.meta.dirname, '..');
const migrations = resolve(root, 'supabase/migrations');
const original = readFileSync(resolve(migrations, '20260826122203_automatic_registration_email_retries.sql'), 'utf8');
const withoutCorrection = args.includes('--without-correction');
const names = readdirSync(migrations).filter(name => name.endsWith('_remove_registration_email_retries.sql'));
if (!withoutCorrection && names.length !== 1) throw new Error('Expected exactly one corrective migration');
const correction = withoutCorrection ? '' : readFileSync(resolve(migrations, names[0]), 'utf8');
const setup = readFileSync(resolve(root, 'tools/registration-email-retry-rollback/setup.sql'), 'utf8');
const assertions = readFileSync(resolve(root, 'tools/registration-email-retry-rollback/assertions.sql'), 'utf8');
const sql = `
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
${setup}
${original}
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM cron.job WHERE jobname = 'retry-registration-lifecycle-emails')
    OR to_regprocedure('public.retry_registration_email_delivery(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('public.get_registration_email_delivery_statuses(uuid,uuid)') IS NULL
    OR to_regprocedure('private.registration_lifecycle_delivery(uuid,text,timestamptz,timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Historical migration did not establish the retry system';
  END IF;
END $$;
${correction}
${assertions}
-- Reproduce production: objects remain, but the job was already unscheduled.
${original}
SELECT cron.unschedule('retry-registration-lifecycle-emails');
${correction}
${correction}
${assertions}
ROLLBACK;
`;
const result = spawnSync('docker', [
  'exec', '-i', 'supabase_db_event-registration-system',
  'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
], { input: sql, encoding: 'utf8', timeout: 120_000 });
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
console.log('PASS: historical retry migration -> correction; already-unscheduled -> correction twice.');
console.log('PASS: retry job/functions absent; registration/delivery data, other jobs, functions and triggers preserved.');
console.log('All fixtures and schema/job changes rolled back; no mail was dispatched.');
