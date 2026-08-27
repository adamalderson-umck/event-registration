import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const migrationDir = path.join(root, 'supabase/migrations');
const historicalName = '20260826122203_automatic_registration_email_retries.sql';

describe('registration email retry retirement', () => {
  it('retains applied history and supplies a later corrective migration', () => {
    const names = fs.readdirSync(migrationDir).sort();
    expect(names).toContain(historicalName);
    const corrections = names.filter(name => name.endsWith('_remove_registration_email_retries.sql'));
    expect(corrections).toHaveLength(1);
    expect(corrections[0] > historicalName).toBe(true);
    const sql = fs.readFileSync(path.join(migrationDir, corrections[0]), 'utf8');
    expect(sql).toContain("jobname = 'retry-registration-lifecycle-emails'");
    expect(sql).toMatch(/PERFORM cron\.unschedule\(v_job_id\)/);
    for (const name of [
      'public.retry_registration_email_delivery',
      'public.get_registration_email_delivery_statuses',
      'private.registration_lifecycle_delivery',
    ]) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS ${name}(`);
    }
    expect(sql).not.toMatch(/\b(?:CASCADE|TRUNCATE|DELETE\s+FROM|DROP\s+TABLE)\b/i);
    expect(sql).not.toMatch(/cron\.schedule\s*\(/i);
  });

  it('removes the retry-only UI, service, and lifecycle module', () => {
    for (const filename of [
      'src/components/RegistrationActionsMenu.jsx',
      'src/components/RegistrationEmailDeliveryCard.jsx',
      'src/services/registrationEmailDelivery.js',
      'supabase/functions/_shared/registration-email-lifecycle.ts',
    ]) {
      expect(fs.existsSync(path.join(root, filename)), filename).toBe(false);
    }
    const viewer = fs.readFileSync(path.join(root, 'src/components/RegistrationViewer.jsx'), 'utf8');
    expect(viewer).not.toMatch(/registrationEmailDelivery|RegistrationEmailDeliveryCard|Retry failed email|Email intervention/);
    expect(fs.existsSync(path.join(root, 'src/components/ParkingRegistrationActionsMenu.jsx'))).toBe(true);
  });
});
