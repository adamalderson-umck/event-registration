import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.resolve(
  process.cwd(),
  'supabase/migrations/20260819090000_parking_pass_finalization.sql',
), 'utf8');

describe('parking pass finalization migration', () => {
  it('adds a consistent current-state projection and guards direct writes', () => {
    expect(sql).toMatch(/add column if not exists parking_pass_finalized_at timestamptz/i);
    expect(sql).toMatch(/add column if not exists parking_pass_finalized_by uuid/i);
    expect(sql).toMatch(/add column if not exists parking_pass_finalized_by_name text/i);
    expect(sql).toMatch(/registrations_parking_pass_finalization_metadata_check/i);
    expect(sql).toMatch(/before insert on public\.registrations[\s\S]*initialize_parking_pass_finalization_projection/i);
    expect(sql).toMatch(/before update of[\s\S]*parking_pass_finalized_at[\s\S]*parking_pass_finalized_by[\s\S]*parking_pass_finalized_by_name/i);
    expect(sql).toMatch(/current_setting\('app\.parking_pass_finalization_write', true\)/i);
  });

  it('creates immutable organization-scoped audit history', () => {
    expect(sql).toMatch(/create table public\.parking_pass_finalization_events/i);
    expect(sql).toMatch(/check \(action in \('finalized', 'reopened'\)\)/i);
    expect(sql).toMatch(/for select[\s\S]+to authenticated[\s\S]+private\.is_org_member/i);
    expect(sql).toMatch(/revoke all on table public\.parking_pass_finalization_events\s+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select on table public\.parking_pass_finalization_events to authenticated/i);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]+parking_pass_finalization_events[^;]+to authenticated/i);
  });

  it('locks and validates an organization parking registration', () => {
    expect(sql).toMatch(/create or replace function private\.transition_parking_pass_finalization/i);
    expect(sql).toMatch(/create or replace function public\.finalize_parking_pass/i);
    expect(sql).toMatch(/create or replace function public\.undo_parking_pass_finalization/i);
    expect(sql).toMatch(/if not private\.is_org_member\(p_org_id\)/i);
    expect(sql).toMatch(/for update of registrations/i);
    expect(sql).toMatch(/v_event_type is distinct from 'parking'/i);
    expect(sql).toMatch(/v_registration\.status <> 'confirmed'/i);
    expect(sql).toMatch(/v_registration\.payment_status <> 'paid'/i);
    expect(sql).toMatch(/v_registration\.parking_pass_finalized_at is distinct from p_expected_finalized_at/i);
  });

  it('updates projection and history in the same function', () => {
    expect(sql).toMatch(/set_config\('app\.parking_pass_finalization_write', 'allowed', true\)/i);
    expect(sql).toMatch(/update public\.registrations as registrations[\s\S]+parking_pass_finalized_at/i);
    expect(sql).toMatch(/insert into public\.parking_pass_finalization_events/i);
    expect(sql).toMatch(/'finalization_conflict'/i);
    expect(sql).toMatch(/'not_eligible'/i);
  });

  it('exposes the transition only to signed-in roles', () => {
    expect(sql).toMatch(/revoke all on function public\.finalize_parking_pass\(uuid, uuid\)\s+from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.undo_parking_pass_finalization\(uuid, uuid, timestamptz\)\s+from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.finalize_parking_pass\(uuid, uuid\)\s+to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.undo_parking_pass_finalization\(uuid, uuid, timestamptz\)\s+to authenticated/i);
  });
});
