import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.resolve(
  process.cwd(),
  'supabase/migrations/20260807120000_admin_registration_answer_edits.sql',
), 'utf8');

describe('registration answer edit migration', () => {
  it('creates organization-scoped immutable history', () => {
    expect(sql).toMatch(/create table public\.registration_answer_edits/i);
    expect(sql).toMatch(
      /for select[\s\S]+to authenticated[\s\S]+private\.is_org_member/i,
    );
    expect(sql).toMatch(
      /revoke all on table public\.registration_answer_edits\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant select on table public\.registration_answer_edits to authenticated/i,
    );
    expect(sql).not.toMatch(
      /grant (insert|update|delete)[^;]+registration_answer_edits[^;]+authenticated/i,
    );
  });

  it('locks and compares the canonical registration', () => {
    expect(sql).toMatch(
      /create or replace function public\.apply_registration_answer_edit/i,
    );
    expect(sql).toMatch(/for update of registrations/i);
    expect(sql).toMatch(
      /v_registration\.form_data is distinct from p_expected_form_data/i,
    );
    expect(sql).toMatch(/v_registration\.status = 'cancelled'/i);
  });

  it('updates only form_data and inserts history atomically', () => {
    expect(sql).toMatch(
      /update public\.registrations\s+set form_data = p_new_form_data/i,
    );
    expect(sql).not.toMatch(
      /set[\s\S]{0,120}(status|payment_status|signature_records)\s*=/i,
    );
    expect(sql).toMatch(/insert into public\.registration_answer_edits/i);
  });

  it('exposes mutation only to service_role', () => {
    expect(sql).toMatch(
      /revoke all on function public\.apply_registration_answer_edit[^;]+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_registration_answer_edit[^;]+to service_role/i,
    );
  });
});
