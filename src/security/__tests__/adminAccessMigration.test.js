import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const migrationName = fs.readdirSync(migrationsDir)
  .find((name) => name.endsWith('_restrict_admin_access_to_kentmethodist_org.sql'));

const migrationSql = migrationName
  ? fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8')
  : '';
const identityMigrationName = fs.readdirSync(migrationsDir)
  .find((name) => name.endsWith('_require_verified_google_identity_email.sql'));
const identityMigrationSql = identityMigrationName
  ? fs.readFileSync(path.join(migrationsDir, identityMigrationName), 'utf8')
  : '';

describe('kentmethodist.org admin authorization migration', () => {
  it('requires both the exact managed domain and a Google identity', () => {
    expect(migrationName).toBeDefined();
    expect(migrationSql).toMatch(/create or replace function public\.is_kentmethodist_admin\(\)/i);
    expect(migrationSql).toMatch(/create or replace function private\.is_kentmethodist_admin_user\(p_user_id uuid\)/i);
    expect(migrationSql).toMatch(/auth\.identities/i);
    expect(migrationSql).toMatch(/provider\s*=\s*'google'/i);
    expect(migrationSql).toMatch(/kentmethodist\[\.\]org/i);
    expect(identityMigrationName).toBeDefined();
    expect(identityMigrationSql).toMatch(/identities\.identity_data\s*->>\s*'email'/i);
    expect(identityMigrationSql).toMatch(/identity_data\s*->>\s*'email_verified'/i);
  });

  it('removes self-service membership escalation and scopes membership writes', () => {
    expect(migrationSql).toMatch(/drop policy if exists "?org_members_admin_insert"?/i);
    expect(migrationSql).toMatch(/role\s*=\s*'owner'/i);
    expect(migrationSql).toMatch(/owner_uid\s*=\s*\(select auth\.uid\(\)\)/i);
    expect(migrationSql).toMatch(/private\.is_kentmethodist_admin_user\(p_user_id\)/i);
    expect(migrationSql).toMatch(
      /private\.can_add_org_member\(org_members\.org_id, org_members\.user_id, org_members\.role\)/i,
    );
  });

  it('revokes public execution of privileged and trigger-only functions', () => {
    expect(migrationSql).toMatch(/revoke all on function public\.get_org_smtp_secret\(uuid\) from public/i);
    expect(migrationSql).toMatch(/revoke all on function public\.update_payment_status\(uuid, text, text, jsonb\) from public/i);
    expect(migrationSql).toMatch(/revoke all on function public\.handle_new_registration\(\) from public/i);
    expect(migrationSql).toMatch(/grant execute on function public\.get_org_smtp_secret\(uuid\) to service_role/i);
  });
});
