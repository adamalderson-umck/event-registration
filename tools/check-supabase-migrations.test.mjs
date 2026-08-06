import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { validateMigrationDirectory } from './check-supabase-migrations.mjs';

const temporaryDirectories = [];

function createMigrationsDirectory() {
  const directory = mkdtempSync(path.join(process.env.TEMP || process.cwd(), 'migration-validator-'));
  const migrationsDirectory = path.join(directory, 'migrations');
  mkdirSync(migrationsDirectory);
  temporaryDirectories.push(directory);
  return migrationsDirectory;
}

function writeMigration(directory, filename, sql = '-- migration') {
  writeFileSync(path.join(directory, filename), sql);
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('validateMigrationDirectory', () => {
  it('accepts an expected migration and a later secure Tithe.ly migration with custom history', () => {
    const directory = createMigrationsDirectory();
    const expected = '20260101000000_initial_schema.sql';
    writeMigration(directory, expected);
    writeMigration(
      directory,
      '20260101000001_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN
          PERFORM private.is_org_member(p_org_id);
          IF payment_method IN ('tithely', 'in_person') THEN NULL; END IF;
        END;
        $$;`,
    );

    expect(validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [expected],
      latestAppliedVersion: '20260101000000',
    })).toEqual({
      errors: [],
      files: [expected, '20260101000001_tithely_payment_flow.sql'],
    });
  });

  it('rejects short filenames, duplicate versions, and unexpected historical migrations', () => {
    const directory = createMigrationsDirectory();
    writeMigration(directory, '20260101000000_initial_schema.sql');
    writeMigration(directory, '20260101000000_other_schema.sql');
    writeMigration(directory, '20260102000000_future_schema.sql');
    writeMigration(directory, '20260101_legacy.sql', `sb_${'secret_'}${'e'.repeat(12)}`);

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: ['20260101000000_initial_schema.sql'],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/invalid migration filename/i);
    expect(errors.join('\n')).toMatch(/duplicate migration version/i);
    expect(errors.join('\n')).toMatch(/unexpected historical migration/i);
    expect(errors.join('\n')).toMatch(/Supabase secret key/i);
  });

  it('rejects missing expected migrations and dynamically constructed secret-shaped values', () => {
    const directory = createMigrationsDirectory();
    const projectUrl = `https://${'a'.repeat(20)}.supabase.co`;
    const jwt = `${'eyJ' + 'a'.repeat(12)}.${'eyJ' + 'b'.repeat(12)}.${'c'.repeat(16)}`;
    const secretKey = `sb_${'secret_'}${'d'.repeat(12)}`;
    writeMigration(directory, '20260102000000_future_schema.sql', `${projectUrl}\n${jwt}\n${secretKey}`);

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: ['20260101000000_initial_schema.sql'],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/missing expected migration/i);
    expect(errors.join('\n')).toMatch(/project-specific Supabase URL/i);
    expect(errors.join('\n')).toMatch(/JWT-shaped value/i);
    expect(errors.join('\n')).toMatch(/Supabase secret key/i);
  });

  it('rejects every insecure Tithe.ly payment-flow contract violation', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          UPDATE public.registrations SET payment_method = 'tithely';
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/SECURITY INVOKER/i);
    expect(errors.join('\n')).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(errors.join('\n')).toMatch(/payment_method IN \('tithely', 'in_person'\)/i);
    expect(errors.join('\n')).toMatch(/must not assign payment_method/i);
  });

  it('does not accept Tithe.ly protections that appear only in SQL comments', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `/* SECURITY INVOKER private.is_org_member(p_org_id)
          payment_method IN ('tithely', 'in_person') */
        CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          -- SECURITY INVOKER private.is_org_member(p_org_id)
          -- payment_method IN ('tithely', 'in_person')
          NULL;
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/SECURITY INVOKER/i);
    expect(errors.join('\n')).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(errors.join('\n')).toMatch(/payment_method IN \('tithely', 'in_person'\)/i);
  });

  it('does not accept Tithe.ly protections after an inner nested block comment closes', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `/* outer comment /* inner comment */ SECURITY INVOKER
          private.is_org_member(p_org_id)
          payment_method IN ('tithely', 'in_person') */
        CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          NULL;
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/SECURITY INVOKER/i);
    expect(errors.join('\n')).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(errors.join('\n')).toMatch(/payment_method IN \('tithely', 'in_person'\)/i);
  });

  it('ignores commented payment_method assignments in compliant Tithe.ly migrations', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN
          PERFORM private.is_org_member(p_org_id);
          IF payment_method IN ('tithely', 'in_person') THEN NULL; END IF;
          -- SET payment_method = 'tithely'
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors).toEqual([]);
  });

  it('does not accept security markers embedded in a quoted literal in mark_registration_paid', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          PERFORM 'SECURITY INVOKER private.is_org_member(p_org_id) payment_method IN (''tithely'', ''in_person'')';
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/SECURITY INVOKER/i);
    expect(errors.join('\n')).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(errors.join('\n')).toMatch(/payment_method IN \('tithely', 'in_person'\)/i);
  });

  it('does not accept markers from an unrelated function', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.other_function(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN
          PERFORM private.is_org_member(p_org_id);
          IF payment_method IN ('tithely', 'in_person') THEN NULL; END IF;
        END;
        $$;
        CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          NULL;
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/SECURITY INVOKER/i);
    expect(errors.join('\n')).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(errors.join('\n')).toMatch(/payment_method IN \('tithely', 'in_person'\)/i);
  });

  it('ignores quoted SET payment_method text in a secure mark_registration_paid body', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN
          PERFORM private.is_org_member(p_org_id);
          IF payment_method IN ('tithely', 'in_person') THEN NULL; END IF;
          PERFORM 'SET payment_method = ''x''';
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors).toEqual([]);
  });

  it('detects a payment_method assignment after a $$ delimiter inside a quoted body literal', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN
          PERFORM private.is_org_member(p_org_id);
          IF payment_method IN ('tithely', 'in_person') THEN NULL; END IF;
          PERFORM '$$';
          UPDATE public.registrations SET payment_method = 'in_person_verified';
        END;
        $$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/must not assign payment_method/i);
  });

  it('detects a payment_method assignment after a tagged delimiter inside a quoted body literal', () => {
    const directory = createMigrationsDirectory();
    writeMigration(
      directory,
      '20260102000000_tithely_payment_flow.sql',
      `CREATE OR REPLACE FUNCTION public.mark_registration_paid(p_org_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $function$
        BEGIN
          PERFORM private.is_org_member(p_org_id);
          IF payment_method IN ('tithely', 'in_person') THEN NULL; END IF;
          PERFORM '$function$';
          UPDATE public.registrations SET payment_method = 'in_person_verified';
        END;
        $function$;`,
    );

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [],
      latestAppliedVersion: '20260101000000',
    });

    expect(errors.join('\n')).toMatch(/must not assign payment_method/i);
  });
});
