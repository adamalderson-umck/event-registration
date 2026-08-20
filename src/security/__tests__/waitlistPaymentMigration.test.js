import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260820150000_defer_waitlist_payments.sql';
const migrationPath = path.resolve(import.meta.dirname, '../../../supabase/migrations', migrationName);
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

describe('deferred waitlist payment migration', () => {
  it('normalizes new waitlisted registrations before insert consumers run', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/create or replace function public\.handle_new_registration\(\)/i);
    expect(sql).toMatch(/if v_new_status = 'waitlisted'[\s\S]*new\.payment_method := null[\s\S]*new\.payment_status := 'not_required'/i);
    expect(sql).toMatch(/v_new_status = 'confirmed'[\s\S]*v_event\.payment_enabled[\s\S]*new\.payment_method is null[\s\S]*payment_selection_required/i);
  });

  it('activates payment when a waitlisted registration is promoted', () => {
    expect(sql).toMatch(/create or replace function private\.apply_waitlist_payment_lifecycle\(\)/i);
    expect(sql).toMatch(/old\.status <> 'waitlisted'[\s\S]*new\.status <> 'confirmed'/i);
    expect(sql).toMatch(/new\.payment_method := null/i);
    expect(sql).toMatch(/when v_payment_enabled then 'pending'[\s\S]*else 'not_required'/i);
    expect(sql).toMatch(/before update of status on public\.registrations/i);
    expect(sql).toMatch(/set_config\('app\.payment_projection_write', 'allowed', true\)/i);
  });

  it('does not rewrite historical registrations', () => {
    expect(sql).not.toMatch(/update\s+public\.registrations\s+set/i);
  });
});
