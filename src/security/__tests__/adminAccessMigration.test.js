import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const baselineName = fs.readdirSync(migrationsDir)
  .find((name) => name.endsWith('_require_verified_google_identity_email.sql'));
const baselineSql = baselineName
  ? fs.readFileSync(path.join(migrationsDir, baselineName), 'utf8').replaceAll('"', '')
  : '';

describe('kentmethodist.org admin authorization schema baseline', () => {
  it('requires both the exact managed domain and a Google identity', () => {
    expect(baselineName).toBeDefined();
    expect(baselineSql).toMatch(/create or replace function public\.is_kentmethodist_admin\(\)/i);
    expect(baselineSql).toMatch(/create or replace function private\.is_kentmethodist_admin_user\(p_user_id uuid\)/i);
    expect(baselineSql).toMatch(/auth\.identities/i);
    expect(baselineSql).toMatch(/provider\s*=\s*'google'/i);
    expect(baselineSql).toMatch(/kentmethodist\[\.\]org/i);
    expect(baselineSql).toMatch(/identities\.identity_data\s*->>\s*'email'/i);
    expect(baselineSql).toMatch(/identity_data\s*->>\s*'email_verified'/i);
  });

  it('prevents self-service membership escalation and scopes membership writes', () => {
    expect(baselineSql).toMatch(/create policy org_members_admin_insert/i);
    expect(baselineSql).toMatch(/role\s*=\s*'owner'/i);
    expect(baselineSql).toMatch(/owner_uid\s*=\s*\(\s*select auth\.uid\(\)/i);
    expect(baselineSql).toMatch(/private\.is_kentmethodist_admin_user\(p_user_id\)/i);
    expect(baselineSql).toMatch(
      /private\.can_add_org_member\(org_members\.org_id, org_members\.user_id, org_members\.role\)/i,
    );
  });

  it('revokes public execution of privileged and trigger-only functions', () => {
    expect(baselineSql).toMatch(/revoke all on function public\.get_org_smtp_secret\(p_org_id uuid\) from public/i);
    expect(baselineSql).toMatch(/revoke all on function public\.update_payment_status\(p_registration_id uuid, p_payment_status text, p_payment_method text, p_payment_details jsonb\) from public/i);
    expect(baselineSql).toMatch(/revoke all on function public\.handle_new_registration\(\) from public/i);
    expect(baselineSql).toMatch(/grant all on function public\.get_org_smtp_secret\(p_org_id uuid\) to service_role/i);
  });
});
