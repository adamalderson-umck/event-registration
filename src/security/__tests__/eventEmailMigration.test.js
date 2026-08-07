import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDirectory)
    .find((name) => name.endsWith('_event_email_message_control.sql'));

if (!migrationName) throw new Error('event_email_message_control migration is missing');
const sql = readFileSync(path.join(migrationsDirectory, migrationName), 'utf8');

describe('event email message control migration', () => {
    it('adds the two event message columns and active-event invariants', () => {
        expect(sql).toMatch(/add column(?: if not exists)? confirmation_message text/i);
        expect(sql).toMatch(/add column(?: if not exists)? reminder_message text/i);
        expect(sql).toMatch(/event_type\s*<>\s*'parking'[\s\S]+coalesce\(btrim\(confirmation_message\),\s*''\)\s*<>\s*''/i);
        expect(sql).toMatch(/reminder_hours_before is null[\s\S]+coalesce\(btrim\(reminder_message\),\s*''\)\s*<>\s*''/i);
    });

    it('backfills the approved starter messages before adding constraints', () => {
        expect(sql).toContain('Thank you for registering for this parking event.');
        expect(sql).toContain('This is a friendly reminder that your event is coming up soon!');
        expect(sql.indexOf('Thank you for registering')).toBeLessThan(
            sql.indexOf('events_active_parking_confirmation_message_check')
        );
    });

    it('creates a service-role-only delivery ledger', () => {
        expect(sql).toMatch(/create table public\.email_deliveries/i);
        expect(sql).toMatch(/delivery_key text not null unique/i);
        expect(sql).toMatch(/state text not null default 'pending'/i);
        expect(sql).toContain("'registration_waitlist'");
        expect(sql).toMatch(/enable row level security/i);
        expect(sql).toMatch(/revoke all on table public\.email_deliveries from public, anon, authenticated/i);
        expect(sql).toMatch(/grant select, insert, update on table public\.email_deliveries to service_role/i);
    });

    it('loads the protected webhook credential from Vault', () => {
        expect(sql).toMatch(/from vault\.decrypted_secrets[\s\S]+name\s*=\s*'service_role_key'/i);
        expect(sql).not.toMatch(/current_setting\('app\.settings\.service_role_key'/i);
    });

    it('preserves the hourly reminder schedule with Vault-backed authentication', () => {
        expect(sql).toMatch(
            /cron\.schedule\([\s\S]+?'send-event-reminders'[\s\S]+?'0 \* \* \* \*'[\s\S]+?name\s*=\s*'project_url'[\s\S]+?name\s*=\s*'service_role_key'/i
        );
    });

    it('replaces full-row anonymous webhook payloads with protected transition identifiers', () => {
        expect(sql).toMatch(/'registration_id',\s*new\.id/i);
        expect(sql).toMatch(/'type',\s*'INSERT'/i);
        expect(sql).toMatch(/'type',\s*'UPDATE'/i);
        expect(sql).toMatch(/'old_status',\s*old\.status/i);
        expect(sql).toMatch(/'new_status',\s*new\.status/i);
        expect(sql).not.toMatch(/to_jsonb\(new\)/i);
        expect(sql).not.toMatch(/name\s*=\s*'anon_key'/i);
    });
});
