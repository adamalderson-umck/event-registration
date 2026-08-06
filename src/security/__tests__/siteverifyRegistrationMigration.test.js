import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20260806070000_enforce_siteverify_registration_insert.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

describe('Siteverify registration migration', () => {
    it('removes the public registration insert policy', () => {
        expect(sql).toMatch(
            /drop policy if exists "?registrations_insert_valid"? on public\.registrations/i
        );
    });

    it('revokes anonymous inserts without granting them back', () => {
        expect(sql).toMatch(
            /revoke insert on table public\.registrations from anon/i
        );
        expect(sql).not.toMatch(
            /grant\s+insert\s+on(?:\s+table)?\s+public\.registrations\s+to\s+anon/i
        );
    });

    it('limits authenticated CSV imports to organization members and active matching events', () => {
        expect(sql).toMatch(
            /create\s+policy\s+"?registrations_authenticated_member_insert"?[\s\S]+on\s+public\.registrations[\s\S]+for\s+insert[\s\S]+to\s+authenticated/i
        );
        expect(sql).toMatch(
            /private\.is_org_member\(registrations\.org_id\)/i
        );
        expect(sql).toMatch(
            /events\.id\s*=\s*registrations\.event_id[\s\S]+events\.org_id\s*=\s*registrations\.org_id[\s\S]+events\.status\s*=\s*'active'/i
        );
        expect(sql).not.toMatch(
            /revoke\s+insert\s+on(?:\s+table)?\s+public\.registrations\s+from\s+[^;]*\bauthenticated\b/i
        );
    });
});
