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

    it('revokes direct inserts from both browser roles', () => {
        expect(sql).toMatch(
            /revoke insert on table public\.registrations from anon, authenticated/i
        );
    });

    it('does not grant browser roles another registration insert path', () => {
        expect(sql).not.toMatch(
            /grant\s+insert\s+on(?:\s+table)?\s+public\.registrations\s+to\s+(?:anon|authenticated)/i
        );
        expect(sql).not.toMatch(/create\s+policy[\s\S]+on\s+public\.registrations\s+for\s+insert/i);
    });
});
