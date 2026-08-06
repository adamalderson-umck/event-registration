import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const migrationName = fs.readdirSync(migrationsDir)
  .find((name) => name.endsWith('_registration_payment_ledger.sql'));
const migrationSql = migrationName
  ? fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8')
  : '';

function functionSql(name) {
  const start = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const end = migrationSql.indexOf('\n$$;', start);

  expect(start, `expected ${name} to be defined`).toBeGreaterThanOrEqual(0);
  expect(end, `expected ${name} to end with $$;`).toBeGreaterThan(start);

  return migrationSql.slice(start, end + '\n$$;'.length);
}

function triggerSql(name) {
  const start = migrationSql.indexOf(`CREATE TRIGGER ${name}`);
  const end = migrationSql.indexOf(';', start);

  expect(start, `expected ${name} trigger to be defined`).toBeGreaterThanOrEqual(0);
  expect(end, `expected ${name} trigger to end with ;`).toBeGreaterThan(start);

  return migrationSql.slice(start, end + 1);
}

describe('registration payment ledger migration', () => {
  it('creates the normalized payment ledger with finite positive amounts and its active Tithe.ly uniqueness contract', () => {
    expect(migrationName).toBeDefined();
    expect(migrationSql).toMatch(/create table public\.registration_payments/i);
    expect(migrationSql).toMatch(/payment_expected_amount\s+numeric\(12,\s*2\)/i);
    expect(migrationSql).toMatch(/payment_recorded_total\s+numeric\(12,\s*2\)/i);
    expect(migrationSql).toMatch(/legacy_payment_paid\s+boolean/i);
    expect(migrationSql).toMatch(/payment_method\s+in\s*\('cash',\s*'check',\s*'tithely'\)/i);
    expect(migrationSql).toMatch(/amount\s+numeric\(12,\s*2\)\s+not null check\s*\(\s*amount\s*>\s*0\s+and\s+amount\s*<>\s*'nan'::numeric\s+and\s+amount\s*<>\s*'infinity'::numeric\s+and\s+amount\s*<>\s*'-infinity'::numeric\s*\)/i);
    expect(migrationSql).toMatch(/registration_id\s+uuid\s+not null references public\.registrations\(id\) on delete restrict/i);
    expect(migrationSql).toMatch(/org_id\s+uuid\s+not null references public\.organizations\(id\) on delete restrict/i);
    expect(migrationSql).toMatch(/created_at\s+timestamptz\s+not null default now\(\)/i);
    expect(migrationSql).toMatch(/registration_payments_cash_reference_check/i);
    expect(migrationSql).toMatch(/registration_payments_non_cash_reference_check\s+check\s*\(\s*payment_method\s*=\s*'cash'\s+or\s+\(reference_number\s+is\s+not\s+null\s+and\s+btrim\(reference_number\)\s*<>\s*''\)\s*\)/i);
    expect(migrationSql).toMatch(/registration_payments_void_metadata_check\s+check\s*\(\s*\(voided_at\s+is\s+null\s+and\s+voided_by\s+is\s+null\s+and\s+void_reason\s+is\s+null\)\s+or\s+\(voided_at\s+is\s+not\s+null\s+and\s+voided_by\s+is\s+not\s+null\s+and\s+void_reason\s+is\s+not\s+null\s+and\s+btrim\(void_reason\)\s*<>\s*''\)\s*\)/i);
    expect(migrationSql).toMatch(/create unique index.*org_id.*lower\(btrim\(reference_number\)\).*payment_method\s*=\s*'tithely'.*voided_at\s+is\s+null/is);
  });

  it('initializes and protects payment projections through scoped trigger contracts', () => {
    const initialize = functionSql('private.initialize_registration_payment_projection()');
    const guard = functionSql('private.guard_registration_payment_projection()');
    const initializeTrigger = triggerSql('initialize_registration_payment_projection');
    const guardTrigger = triggerSql('guard_registration_payment_projection');

    expect(initialize).toMatch(/security definer\s+set search_path to ''/i);
    expect(initialize).toMatch(/select events\.payment_enabled, events\.payment_amount[\s\S]*from public\.events/i);
    expect(initialize).toMatch(/new\.payment_expected_amount\s*:=\s*case[\s\S]*v_payment_enabled[\s\S]*v_payment_amount/i);
    expect(initializeTrigger).toMatch(/before insert on public\.registrations[\s\S]*execute function private\.initialize_registration_payment_projection\(\)/i);
    expect(guard).toMatch(/current_setting\('app\.payment_projection_write',\s*true\)/i);
    expect(guardTrigger).toMatch(/before update of payment_expected_amount[\s\S]*on public\.registrations[\s\S]*execute function private\.guard_registration_payment_projection\(\)/i);
  });

  it('migrates historical projections without fabricating ledger rows', () => {
    const historicalStart = migrationSql.indexOf('UPDATE public.registrations AS registrations');
    const historicalEnd = migrationSql.indexOf('ALTER TABLE public.registrations', historicalStart);
    const historicalMigration = migrationSql.slice(historicalStart, historicalEnd);

    expect(historicalMigration).toMatch(/legacy_payment_paid\s*=\s*registrations\.payment_status\s*=\s*'paid'/i);
    expect(historicalMigration).toMatch(/when registrations\.payment_status\s*=\s*'paid' then null/i);
    expect(historicalMigration).toMatch(/payment_recorded_total\s*=\s*0/i);
    expect(historicalMigration).toMatch(/when registrations\.payment_status\s*=\s*'paid' then 'paid'/i);
    expect(historicalMigration).not.toMatch(/\binsert\b/i);
    expect(historicalMigration).toMatch(/when events\.payment_enabled and events\.payment_amount\s*>\s*0 then events\.payment_amount::numeric\(12,\s*2\)[\s\S]*else null/i);
    expect(historicalMigration).toMatch(/when events\.payment_enabled then 'pending'[\s\S]*else 'not_required'/i);
  });

  it('allows only authenticated organization members to read the ledger', () => {
    expect(migrationSql).toMatch(/alter table public\.registration_payments enable row level security/i);
    expect(migrationSql).toMatch(/create policy registration_payments_org_read[\s\S]*on public\.registration_payments[\s\S]*for select[\s\S]*to authenticated[\s\S]*private\.is_org_member\(registration_payments\.org_id\)/i);
  });

  it('derives statuses without overpayment and preserves paid legacy records', () => {
    const refresh = functionSql('private.refresh_registration_payment_projection(');

    expect(refresh).toMatch(/security definer\s+set search_path to ''/i);
    expect(refresh).toMatch(/legacy_payment_paid[\s\S]*v_next_payment_status\s*:=\s*'paid'/i);
    expect(refresh).toMatch(/v_recorded_total\s*=\s*0[\s\S]*v_next_payment_status\s*:=\s*'pending'/i);
    expect(refresh).toMatch(/payment_expected_amount\s+is\s+null[\s\S]*v_next_payment_status\s*:=\s*'paid'/i);
    expect(refresh).toMatch(/v_recorded_total\s*<[\s\S]*payment_expected_amount[\s\S]*v_next_payment_status\s*:=\s*'partial'/i);
    expect(refresh).toMatch(/not v_payment_enabled[\s\S]*v_next_payment_status\s*:=\s*'not_required'/i);
    expect(migrationSql).toMatch(/check \(payment_status in \('not_required',\s*'pending',\s*'partial',\s*'paid'\)\)/i);
    expect(migrationSql).not.toMatch(/overpaid/i);
    expect(migrationSql).not.toMatch(/in_person_verified/i);
  });

  it('returns the registration payment result through a secure private helper', () => {
    const result = functionSql('private.registration_payment_result(');

    expect(result).toMatch(/security definer\s+set search_path to ''/i);
    expect(result).toMatch(/jsonb_agg\([\s\S]*order by registration_payments\.payment_date desc, registration_payments\.created_at desc/i);
  });

  it('keeps the record RPC authorized, finite, locked, and projection-backed', () => {
    const record = functionSql('public.record_registration_payment(');

    expect(record).toMatch(/security definer\s+set search_path to ''/i);
    expect(record).toMatch(/if not private\.is_org_member\(p_org_id\)/i);
    expect(record).toMatch(/for update of registrations/i);
    expect(record).toMatch(/v_payment_method\s*:=\s*pg_catalog\.lower\(pg_catalog\.btrim\(p_payment_method\)\)/i);
    expect(record).toMatch(/v_reference_number\s*:=\s*nullif\(pg_catalog\.btrim\(p_reference_number\),\s*''\)/i);
    expect(record).toMatch(/p_amount\s+is\s+null\s+or\s+p_amount\s*<=\s*0\s+or\s+p_amount\s*=\s*'nan'::numeric\s+or\s+p_amount\s*=\s*'infinity'::numeric\s+or\s+p_amount\s*=\s*'-infinity'::numeric/i);
    expect(record).toMatch(/v_amount\s*:=\s*pg_catalog\.round\(p_amount,\s*2\)[\s\S]*if v_amount\s*<=\s*0/i);
    expect(record).toMatch(/cash'\s+and\s+v_reference_number\s+is\s+not null[\s\S]*cash payments must not include a reference number/i);
    expect(record).toMatch(/check payments require a reference number/i);
    expect(record).toMatch(/tithe\.ly payments require a reference number/i);
    expect(record).toMatch(/payment date cannot be in the future/i);
    expect(record).toMatch(/when unique_violation[\s\S]*transaction reference already exists/i);
    expect(record).toMatch(/recorded_by[\s\S]*\(select auth\.uid\(\)\)/i);
    expect(record).toMatch(/perform private\.refresh_registration_payment_projection\(p_registration_id, p_org_id\);\s*return private\.registration_payment_result\(p_registration_id, p_org_id\)/i);
  });

  it('keeps the void RPC authorized, locked, and projection-backed', () => {
    const voidPayment = functionSql('public.void_registration_payment(');

    expect(voidPayment).toMatch(/security definer\s+set search_path to ''/i);
    expect(voidPayment).toMatch(/if not private\.is_org_member\(p_org_id\)/i);
    expect(voidPayment).toMatch(/for update of registrations/i);
    expect(voidPayment).toMatch(/for update of registration_payments/i);
    expect(voidPayment).toMatch(/void reason is required/i);
    expect(voidPayment).toMatch(/voided_by\s*=\s*\(select auth\.uid\(\)\)/i);
    expect(voidPayment).toMatch(/perform private\.refresh_registration_payment_projection\(p_registration_id, p_org_id\);\s*return private\.registration_payment_result\(p_registration_id, p_org_id\)/i);
  });

  it('revokes private helpers and exposes only the intended authenticated RPCs', () => {
    expect(migrationSql).toMatch(/revoke all on table public\.registration_payments from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/revoke all on function private\.initialize_registration_payment_projection\(\) from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/revoke all on function private\.guard_registration_payment_projection\(\) from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/revoke all on function private\.refresh_registration_payment_projection\(uuid, uuid\) from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/revoke all on function private\.registration_payment_result\(uuid, uuid\) from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/grant execute on function public\.record_registration_payment[\s\S]*to authenticated/i);
    expect(migrationSql).toMatch(/grant execute on function public\.void_registration_payment[\s\S]*to authenticated/i);
    expect(migrationSql).toMatch(/drop function if exists public\.mark_registration_paid\(uuid, uuid\)/i);
  });
});
