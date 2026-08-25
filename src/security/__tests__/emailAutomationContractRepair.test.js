import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrations = path.resolve(root, 'supabase/migrations');
const repairName = readdirSync(migrations)
    .find((name) => name.endsWith('_repair_email_automation_contract.sql'));
const repairSql = repairName
    ? readFileSync(path.join(migrations, repairName), 'utf8')
    : '';
const config = readFileSync(path.resolve(root, 'supabase/config.toml'), 'utf8');
const registrationIndex = readFileSync(
    path.resolve(root, 'supabase/functions/send-registration-email/send-registration-email.ts'),
    'utf8'
);
const reminderIndex = readFileSync(
    path.resolve(root, 'supabase/functions/send-event-reminders/index.ts'),
    'utf8'
);

function functionBlock(slug) {
    const start = config.indexOf(`[functions.${slug}]`);
    const end = config.indexOf('\n[', start + 1);
    return start < 0 ? '' : config.slice(start, end < 0 ? undefined : end);
}

describe('email automation caller contract repair', () => {
    it('adds one forward repair migration', () => {
        expect(repairName).toBe('20260825160000_repair_email_automation_contract.sql');
    });

    it('uses the dedicated Vault secret and header for triggers and cron', () => {
        expect(repairSql.match(/name\s*=\s*'email_automation_secret'/gi) ?? []).toHaveLength(3);
        expect(repairSql.match(/'x-email-automation-secret'/gi) ?? []).toHaveLength(3);
        expect(repairSql).not.toMatch(/name\s*=\s*'service_role_key'/i);
        expect(repairSql).not.toMatch(/'Authorization'\s*,\s*'Bearer '/i);
        expect(repairSql).toMatch(/'send-event-reminders'[\s\S]+?'0 \* \* \* \*'/i);
    });

    it('loads caller auth separately from the admin database credential', () => {
        for (const source of [registrationIndex, reminderIndex]) {
            expect(source).toMatch(/Deno\.env\.get\("EMAIL_AUTOMATION_SECRET"\)/);
            expect(source).toMatch(/automationSecret,/);
            expect(source).toMatch(/createClient\(supabaseUrl, serviceRoleKey/);
            expect(source).not.toMatch(/automationSecret:\s*serviceRoleKey/);
        }
    });

    it('disables gateway JWT verification for dedicated-secret handlers', () => {
        expect(functionBlock('send-registration-email')).toMatch(/verify_jwt\s*=\s*false/i);
        expect(functionBlock('send-event-reminders')).toMatch(/verify_jwt\s*=\s*false/i);
    });
});
