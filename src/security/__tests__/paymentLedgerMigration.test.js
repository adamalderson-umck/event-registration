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
    expect(migrationSql).toMatch(/registration_id\s+uuid\s+not null references public\.registrations\(id\) on delete restrict/i);
    expect(migrationSql).toMatch(/org_id\s+uuid\s+not null references public\.organizations\(id\) on delete restrict/i);
    expect(migrationSql).toMatch(/created_at\s+timestamptz\s+not null default now\(\)/i);
    expect(migrationSql).toMatch(/reference_number/i);
    expect(migrationSql).toMatch(/voided_at/i);
    expect(migrationSql).toMatch(/registration_payments_cash_reference_check/i);
    expect(migrationSql).toMatch(/registration_payments_non_cash_reference_check\s+check\s*\(\s*payment_method\s*=\s*'cash'\s+or\s+btrim\(reference_number\)\s*<>\s*''\s*\)/i);
    expect(migrationSql).toMatch(/registration_payments_void_metadata_check/i);
    expect(migrationSql).toMatch(/create unique index.*org_id.*lower\(btrim\(reference_number\)\).*payment_method\s*=\s*'tithely'.*voided_at\s+is\s+null/is);
  });

  it('protects payment projections and initializes them from the event', () => {
    expect(migrationSql).toMatch(/create trigger.*before insert on public\.registrations/is);
    expect(migrationSql).toMatch(/payment_projection_write/i);
    expect(migrationSql).toMatch(/current_setting\('app\.payment_projection_write',\s*true\)/i);
    expect(migrationSql).toMatch(/create trigger[\s\S]*before update of payment_expected_amount[\s\S]*on public\.registrations/i);
    expect(migrationSql).toMatch(/create or replace function private\.initialize_registration_payment_projection\(\)[\s\S]*select events\.payment_enabled, events\.payment_amount[\s\S]*from public\.events/i);
    expect(migrationSql).toMatch(/new\.payment_expected_amount\s*:=\s*case[\s\S]*v_payment_enabled[\s\S]*v_payment_amount/i);
  });

  it('allows only authenticated organization members to read the ledger', () => {
    expect(migrationSql).toMatch(/alter table public\.registration_payments enable row level security/i);
    expect(migrationSql).toMatch(/create policy registration_payments_org_read[\s\S]*on public\.registration_payments[\s\S]*for select[\s\S]*to authenticated[\s\S]*private\.is_org_member\(registration_payments\.org_id\)/i);
  });

  it('derives statuses without overpayment and preserves paid legacy records', () => {
    expect(migrationSql).toMatch(/legacy_payment_paid[\s\S]*v_next_payment_status\s*:=\s*'paid'/i);
    expect(migrationSql).toMatch(/v_recorded_total\s*=\s*0[\s\S]*v_next_payment_status\s*:=\s*'pending'/i);
    expect(migrationSql).toMatch(/payment_expected_amount\s+is\s+null[\s\S]*v_next_payment_status\s*:=\s*'paid'/i);
    expect(migrationSql).toMatch(/v_recorded_total\s*<[\s\S]*payment_expected_amount[\s\S]*v_next_payment_status\s*:=\s*'partial'/i);
    expect(migrationSql).toMatch(/not v_payment_enabled[\s\S]*v_next_payment_status\s*:=\s*'not_required'/i);
    expect(migrationSql).toMatch(/check \(payment_status in \('not_required',\s*'pending',\s*'partial',\s*'paid'\)\)/i);
    expect(migrationSql).not.toMatch(/overpaid/i);
    expect(migrationSql).not.toMatch(/in_person_verified/i);
  });

  it('exposes authorized record and void RPCs rather than direct mutations', () => {
    expect(migrationSql).toMatch(/create or replace function public\.record_registration_payment\([\s\S]*?returns jsonb\s+language plpgsql\s+security definer\s+set search_path to ''/i);
    expect(migrationSql).toMatch(/create or replace function public\.void_registration_payment\([\s\S]*?returns jsonb\s+language plpgsql\s+security definer\s+set search_path to ''/i);
    expect(migrationSql).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(migrationSql).toMatch(/for update of registrations/i);
    expect(migrationSql).toMatch(/v_payment_method\s*:=\s*pg_catalog\.lower\(pg_catalog\.btrim\(p_payment_method\)\)/i);
    expect(migrationSql).toMatch(/v_reference_number\s*:=\s*nullif\(pg_catalog\.btrim\(p_reference_number\),\s*''\)/i);
    expect(migrationSql).toMatch(/amount must be positive/i);
    expect(migrationSql).toMatch(/v_amount\s+is\s+null\s+or\s+v_amount\s*<=\s*0/i);
    expect(migrationSql).toMatch(/check payments require a reference number/i);
    expect(migrationSql).toMatch(/tithe\.ly payments require a reference number/i);
    expect(migrationSql).toMatch(/payment date cannot be in the future/i);
    expect(migrationSql).toMatch(/void reason is required/i);
    expect(migrationSql).toMatch(/when unique_violation[\s\S]*transaction reference already exists/i);
    expect(migrationSql).toMatch(/recorded_by[\s\S]*\(select auth\.uid\(\)\)/i);
    expect(migrationSql).toMatch(/voided_by\s*=\s*\(select auth\.uid\(\)\)/i);
    expect(migrationSql).toMatch(/returns jsonb[\s\S]*jsonb_agg\([\s\S]*order by registration_payments\.payment_date desc, registration_payments\.created_at desc/i);
    expect(migrationSql).toMatch(/perform private\.refresh_registration_payment_projection\(p_registration_id, p_org_id\);\s*return private\.registration_payment_result\(p_registration_id, p_org_id\)/i);
    expect(migrationSql).toMatch(/grant execute on function public\.record_registration_payment[\s\S]*to authenticated/i);
    expect(migrationSql).toMatch(/grant execute on function public\.void_registration_payment[\s\S]*to authenticated/i);
    expect(migrationSql).toMatch(/revoke all on table public\.registration_payments from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/revoke all on function private\.refresh_registration_payment_projection\(uuid, uuid\) from public, anon, authenticated/i);
    expect(migrationSql).toMatch(/drop function if exists public\.mark_registration_paid\(uuid, uuid\)/i);
  });
});
