import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDirectory).find((name) =>
    name.endsWith('_allow_service_role_cancel_registration.sql')
);
const migrationSql = migrationName
    ? readFileSync(path.join(migrationsDirectory, migrationName), 'utf8')
    : '';

describe('cancel registration service-role migration', () => {
    it('lets the HMAC-verified backend use the real cancellation function without weakening admin access', () => {
        expect(migrationName).toBeDefined();
        expect(migrationSql).toMatch(
            /create or replace function public\.cancel_registration\(\s*p_registration_id uuid,\s*p_org_id uuid\s*\)/i
        );
        expect(migrationSql).toMatch(
            /if current_user <> 'service_role' and not private\.is_org_member\(p_org_id\) then/i
        );
        expect(migrationSql).toMatch(/update public\.registrations\s+set status = 'cancelled'/i);
        expect(migrationSql).toMatch(/where id = p_registration_id\s+and org_id = p_org_id/i);
        expect(migrationSql).toMatch(
            /revoke all on function public\.cancel_registration\(uuid, uuid\) from public, anon/i
        );
        expect(migrationSql).toMatch(
            /grant execute on function public\.cancel_registration\(uuid, uuid\) to authenticated, service_role/i
        );
    });
});
