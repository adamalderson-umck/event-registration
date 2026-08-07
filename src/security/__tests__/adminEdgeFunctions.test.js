import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readFunction = (name) => fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../supabase/functions', name, 'index.ts'),
  'utf8',
);

describe('admin Edge Function authorization contracts', () => {
  it.each(['resolve-member-email', 'send-organizer-invite'])(
    '%s verifies the caller and the database authorization gate',
    (name) => {
      const source = readFunction(name);
      expect(source).toMatch(/auth\.getUser\(\)/);
      expect(source).toMatch(/rpc\("is_kentmethodist_admin"\)/);
      expect(source).toMatch(/isKentMethodistGoogleUser\(callingUser\)/);
    },
  );

  it('requires organization ownership before service-role membership writes', () => {
    const source = readFunction('resolve-member-email');
    expect(source).toMatch(/org\.owner_uid !== callingUser!\.id/);
    expect(source).toMatch(/isKentMethodistEmail\(normalizedEmail\)/);
    expect(source).toMatch(/isKentMethodistGoogleUser\(foundUser\)/);
  });

  it('requires membership and derives invite content from stored event data', () => {
    const source = readFunction('send-organizer-invite');
    expect(source).toMatch(/from\("org_members"\)/);
    expect(source).toMatch(/from\("events"\)/);
    expect(source).toMatch(/recipient is not an organizer/i);
    expect(source).toMatch(/escapeHtml\(event\.title\)/);
  });

  it('protects registration answer edits with auth, membership, and trusted RPC data', () => {
    const source = readFunction('update-registration-answers');
    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).toMatch(/from\('org_members'\)/);
    expect(source).toMatch(/from\('registrations'\)/);
    expect(source).toMatch(/from\('events'\)/);
    expect(source).toMatch(/rpc\([\s\S]*'apply_registration_answer_edit'/);
    expect(source).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
