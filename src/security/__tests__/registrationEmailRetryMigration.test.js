import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const migrationNames = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('_automatic_registration_email_retries.sql'));
const sql = migrationNames.length === 1
  ? fs.readFileSync(path.join(migrationsDir, migrationNames[0]), 'utf8')
  : '';

function functionSql(name) {
  const start = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION ${name}`, 'i'));
  const end = sql.indexOf('\n$$;', start);
  expect(start, `expected ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `expected ${name} to end with $$;`).toBeGreaterThan(start);
  return sql.slice(start, end + 4);
}

describe('automatic registration email retry migration', () => {
  it('creates exactly one CLI-named migration', () => {
    expect(migrationNames).toHaveLength(1);
  });

  it('defines one shared exact lifecycle-key helper', () => {
    const helper = functionSql('private\\.registration_lifecycle_delivery\\(');
    expect(helper).toMatch(/returns table\s*\(\s*kind text,\s*delivery_key text\s*\)/i);
    expect(helper).toMatch(/to_jsonb\(lifecycle\.occurrence\)\s*#>>\s*'\{\}'/i);
    expect(helper).toMatch(/registration_confirmation/i);
    expect(helper).toMatch(/registration_waitlist/i);
    expect(helper).toMatch(/waitlist_promotion/i);
    expect(helper).toMatch(/registration_cancellation/i);
  });

  it('projects only safe event-scoped lifecycle delivery status', () => {
    const status = functionSql('public\\.get_registration_email_delivery_statuses\\(');
    expect(status).toMatch(/returns table\s*\(\s*registration_id uuid,\s*delivery_id uuid,\s*kind text,\s*state text,\s*attempt_count integer,\s*last_error_code text,\s*attempted_at timestamptz,\s*sent_at timestamptz,\s*next_retry_at timestamptz,\s*exhausted boolean\s*\)/i);
    expect(status).toMatch(/security definer\s+set search_path to ''/i);
    expect(status).toMatch(/auth\.jwt\(\)\s*->>\s*'role'[\s\S]*<>\s*'service_role'/i);
    expect(status).toMatch(/auth\.uid\(\)\) is null/i);
    expect(status).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(status).toMatch(/r\.org_id\s*=\s*p_org_id/i);
    expect(status).toMatch(/r\.event_id\s*=\s*p_event_id/i);
    expect(status).toMatch(/d\.delivery_key\s*=\s*lifecycle\.delivery_key/i);
    expect(status).toMatch(/when 1 then interval '5 minutes'/i);
    expect(status).toMatch(/when 2 then interval '30 minutes'/i);
    expect(status).toMatch(/when 3 then interval '2 hours'/i);
    expect(status).toMatch(/greatest[\s\S]*interval '15 minutes'/i);
    expect(status).toMatch(/d\.state\s*=\s*'failed'[\s\S]*d\.attempt_count\s*>=\s*4/i);
    expect(status).not.toMatch(/form_data|recipient|subject|body|headers|delivery_key\s+text/i);
  });

  it('queues only an owned current exhausted delivery for manual retry', () => {
    const retry = functionSql('public\\.retry_registration_email_delivery\\(');
    expect(retry).toMatch(/security definer\s+set search_path to ''/i);
    expect(retry).toMatch(/auth\.jwt\(\)\s*->>\s*'role'[\s\S]*<>\s*'service_role'/i);
    expect(retry).toMatch(/auth\.uid\(\)\) is null/i);
    expect(retry).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(retry).toMatch(/r\.id\s*=\s*p_registration_id/i);
    expect(retry).toMatch(/r\.org_id\s*=\s*p_org_id/i);
    expect(retry).toMatch(/d\.id\s*=\s*p_delivery_id/i);
    expect(retry).toMatch(/d\.delivery_key\s*=\s*lifecycle\.delivery_key/i);
    expect(retry).toMatch(/v_delivery\.state\s*<>\s*'failed'/i);
    expect(retry).toMatch(/v_delivery\.attempt_count\s*<\s*4/i);
    expect(retry).toMatch(/'code',\s*'registration_not_found'/i);
    expect(retry).toMatch(/'code',\s*'delivery_not_found'/i);
    expect(retry).toMatch(/'code',\s*'not_applicable'/i);
    expect(retry).toMatch(/'code',\s*'not_exhausted'/i);
    expect(retry).toMatch(/'code',\s*'configuration_unavailable'/i);
    expect(retry).toMatch(/name\s*=\s*'project_url'/i);
    expect(retry).toMatch(/name\s*=\s*'email_automation_secret'/i);
    expect(retry).toMatch(/'x-email-automation-secret'/i);
    expect(retry).toMatch(/'type'\s*,\s*'RETRY'/i);
    expect(retry).toMatch(/'delivery_id'\s*,\s*p_delivery_id/i);
    expect(retry).toMatch(/timeout_milliseconds\s*:=\s*30000/i);
    expect(retry).toMatch(/jsonb_build_object\('ok',\s*true,\s*'code',\s*'queued'\)/i);
    expect(retry).not.toMatch(/current_user|user_metadata/i);
  });

  it('schedules a bounded five-minute retry batch with exact keys', () => {
    expect(sql).toMatch(/cron\.unschedule\([\s\S]*retry-registration-lifecycle-emails/i);
    expect(sql).toMatch(/cron\.schedule\(\s*'retry-registration-lifecycle-emails',\s*'\*\/5 \* \* \* \*'/i);
    expect(sql).toMatch(/with applicable as[\s\S]*due as[\s\S]*configuration as/i);
    expect(sql).toMatch(/d\.delivery_key\s*=\s*lifecycle\.delivery_key/i);
    expect(sql).toMatch(/d\.state\s+in\s*\('failed',\s*'pending'\)/i);
    expect(sql).toMatch(/attempt_count\s*<\s*4/i);
    expect(sql).toMatch(/when 1 then interval '5 minutes'/i);
    expect(sql).toMatch(/when 2 then interval '30 minutes'/i);
    expect(sql).toMatch(/when 3 then interval '2 hours'/i);
    expect(sql).toMatch(/greatest[\s\S]*interval '15 minutes'/i);
    expect(sql).toMatch(/order by attempted_at[\s\S]*limit 10/i);
    expect(sql).toMatch(/'type'\s*,\s*'RETRY'/i);
    expect(sql).toMatch(/'delivery_id'\s*,\s*due\.id/i);
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*30000/i);
    expect(sql).not.toMatch(/kind\s*=\s*'organizer_notification'/i);
    expect(sql).not.toMatch(/kind\s*=\s*'event_reminder'/i);
  });

  it('revokes defaults and grants only the intended RPC execution', () => {
    expect(sql).toMatch(/revoke all on function private\.registration_lifecycle_delivery[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.get_registration_email_delivery_statuses[\s\S]*from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.retry_registration_email_delivery[\s\S]*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.get_registration_email_delivery_statuses[\s\S]*to authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.retry_registration_email_delivery[\s\S]*to authenticated, service_role/i);
    expect(sql).not.toMatch(/grant\s+\w*[\s,\w]*\s+on table public\.email_deliveries\s+to\s+authenticated/i);
  });
});
