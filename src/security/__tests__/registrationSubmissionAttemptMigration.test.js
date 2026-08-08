import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');
const migrationNames = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('_add_registration_submission_attempt.sql'));
const migrationName = migrationNames[0];
const sql = migrationName
    ? readFileSync(path.join(migrationsDirectory, migrationName), 'utf8')
    : '';

describe('registration submission attempt migration', () => {
    it('has exactly one generated migration file', () => {
        expect(migrationNames).toHaveLength(1);
        expect(migrationName).toMatch(/^\d{14}_add_registration_submission_attempt\.sql$/);
    });

    it('adds a generated non-null UUID and a named uniqueness constraint', () => {
        expect(sql).toMatch(
            /alter table public\.registrations[\s\S]*add column submission_attempt_id uuid not null default gen_random_uuid\(\)/i,
        );
        expect(sql).toMatch(
            /add constraint registrations_submission_attempt_id_key\s+unique\s*\(submission_attempt_id\)/i,
        );
    });

    it('indexes the active same-event normalized-email time-window lookup', () => {
        expect(sql).toMatch(
            /create index registrations_recent_active_email_idx\s+on public\.registrations\s*\(\s*org_id\s*,\s*event_id\s*,\s*\(\(form_data->>'system_email'\)\)\s*,\s*created_at desc\s*\)\s*where status in \('pending', 'confirmed', 'waitlisted'\)/i,
        );
    });

    it('does not broaden registration-table access', () => {
        expect(sql).not.toMatch(/grant\s+(?:insert|select|update|delete|all)[\s\S]*\b(?:anon|authenticated)\b/i);
        expect(sql).not.toMatch(/disable row level security/i);
        expect(sql).not.toMatch(/drop policy/i);
    });
});
