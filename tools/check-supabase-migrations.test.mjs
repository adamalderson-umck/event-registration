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
  it('accepts marker migrations, one executable baseline, and a later migration', () => {
    const directory = createMigrationsDirectory();
    const marker = '20260101000000_initial_schema.sql';
    const baseline = '20260101000001_schema_baseline.sql';
    writeMigration(
      directory,
      marker,
      '-- Applied remotely; represented by the schema baseline in 20260101000001.',
    );
    writeMigration(directory, baseline, 'CREATE TABLE public.example (id bigint);');
    writeMigration(
      directory,
      '20260101000002_tithely_payment_flow.sql',
      '-- pending migration',
    );

    expect(validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [marker, baseline],
      latestAppliedVersion: '20260101000001',
    })).toEqual({
      errors: [],
      files: [marker, baseline, '20260101000002_tithely_payment_flow.sql'],
    });
  });

  it('rejects executable marker files and a comment-only baseline', () => {
    const directory = createMigrationsDirectory();
    const marker = '20260101000000_initial_schema.sql';
    const baseline = '20260101000001_schema_baseline.sql';
    writeMigration(directory, marker, 'SELECT 1;');
    writeMigration(directory, baseline, '-- no executable schema');

    const { errors } = validateMigrationDirectory(directory, {
      expectedAppliedMigrations: [marker, baseline],
      latestAppliedVersion: '20260101000001',
    });

    expect(errors.join('\n')).toMatch(/comment-only compatibility marker/i);
    expect(errors.join('\n')).toMatch(/baseline must contain executable SQL/i);
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

  it('treats migration SQL as opaque except for credential-shaped values', () => {
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

    expect(errors).toEqual([]);
  });
});
