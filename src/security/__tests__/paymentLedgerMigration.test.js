import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const migrationName = fs.readdirSync(migrationsDir)
  .find((name) => name.endsWith('_registration_payment_ledger.sql'));
const migrationSql = migrationName
  ? fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8')
  : '';

describe('registration payment ledger migration', () => {
  it('creates the normalized payment ledger with its active Tithe.ly uniqueness contract', () => {
    expect(migrationName).toBeDefined();
    expect(migrationSql).toMatch(/create table public\.registration_payments/i);
    expect(migrationSql).toMatch(/payment_expected_amount\s+numeric\(12,\s*2\)/i);
    expect(migrationSql).toMatch(/payment_recorded_total\s+numeric\(12,\s*2\)/i);
    expect(migrationSql).toMatch(/legacy_payment_paid\s+boolean/i);
    expect(migrationSql).toMatch(/payment_method\s+in\s*\('cash',\s*'check',\s*'tithely'\)/i);
    expect(migrationSql).toMatch(/amount\s*>\s*0/i);
    expect(migrationSql).toMatch(/reference_number/i);
    expect(migrationSql).toMatch(/voided_at/i);
    expect(migrationSql).toMatch(/registration_payments_cash_reference_check/i);
    expect(migrationSql).toMatch(/registration_payments_void_metadata_check/i);
    expect(migrationSql).toMatch(/create unique index.*org_id.*lower\(btrim\(reference_number\)\).*payment_method\s*=\s*'tithely'.*voided_at\s+is\s+null/is);
  });

  it('protects payment projections and initializes them from the event', () => {
    expect(migrationSql).toMatch(/create trigger.*before insert on public\.registrations/is);
    expect(migrationSql).toMatch(/payment_projection_write/i);
    expect(migrationSql).toMatch(/current_setting\('app\.payment_projection_write',\s*true\)/i);
    expect(migrationSql).toMatch(/create trigger[\s\S]*before update of payment_expected_amount[\s\S]*on public\.registrations/i);
  });

  it('derives statuses without overpayment and preserves paid legacy records', () => {
    expect(migrationSql).toMatch(/legacy_payment_paid[\s\S]*v_next_payment_status\s*:=\s*'paid'/i);
    expect(migrationSql).toMatch(/v_recorded_total\s*=\s*0[\s\S]*v_next_payment_status\s*:=\s*'pending'/i);
    expect(migrationSql).toMatch(/payment_expected_amount\s+is\s+null[\s\S]*v_next_payment_status\s*:=\s*'paid'/i);
    expect(migrationSql).toMatch(/v_recorded_total\s*<[\s\S]*payment_expected_amount[\s\S]*v_next_payment_status\s*:=\s*'partial'/i);
    expect(migrationSql).not.toMatch(/overpaid/i);
  });

  it('exposes authorized record and void RPCs rather than direct mutations', () => {
    expect(migrationSql).toMatch(/create or replace function public\.record_registration_payment\(/i);
    expect(migrationSql).toMatch(/create or replace function public\.void_registration_payment\(/i);
    expect(migrationSql).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(migrationSql).toMatch(/for update of registrations/i);
    expect(migrationSql).toMatch(/amount must be positive/i);
    expect(migrationSql).toMatch(/v_amount\s+is\s+null\s+or\s+v_amount\s*<=\s*0/i);
    expect(migrationSql).toMatch(/check payments require a reference number/i);
    expect(migrationSql).toMatch(/tithe\.ly payments require a reference number/i);
    expect(migrationSql).toMatch(/payment date cannot be in the future/i);
    expect(migrationSql).toMatch(/void reason is required/i);
    expect(migrationSql).toMatch(/when unique_violation[\s\S]*transaction reference already exists/i);
    expect(migrationSql).toMatch(/grant execute on function public\.record_registration_payment[\s\S]*to authenticated/i);
    expect(migrationSql).toMatch(/grant execute on function public\.void_registration_payment[\s\S]*to authenticated/i);
    expect(migrationSql).toMatch(/revoke all on table public\.registration_payments from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/revoke all on function private\.refresh_registration_payment_projection\(uuid, uuid\) from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/drop function if exists public\.mark_registration_paid\(uuid, uuid\)/i);
  });
});
