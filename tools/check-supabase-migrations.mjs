import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_APPLIED_MIGRATIONS = [
  '20260323175307_initial_schema.sql',
  '20260323175327_rls_policies.sql',
  '20260323175356_database_functions_and_triggers.sql',
  '20260323175432_fix_security_advisories.sql',
  '20260323175449_enable_realtime.sql',
  '20260323181225_fix_update_payment_status_rpc.sql',
  '20260323183057_enable_pgnet_pgcron_extensions.sql',
  '20260323183121_create_email_webhook_triggers.sql',
  '20260323233141_add_registration_close_date_and_reminder.sql',
  '20260324140453_schedule_event_reminders_cron.sql',
  '20260324150933_fix_org_members_rls_recursion.sql',
  '20260324150958_update_other_policies_to_use_helpers.sql',
  '20260324153355_create_profiles_table.sql',
  '20260324154212_fix_handle_new_user_search_path.sql',
  '20260324155204_add_theme_and_header_image.sql',
  '20260324155223_create_event_images_bucket.sql',
  '20260325001721_add_registrations_org_id_index.sql',
  '20260325001753_optimize_rls_initplan_pattern.sql',
  '20260415191801_secure_smtp_config_rpc.sql',
  '20260415192514_secure_smtp_config_rpc_fixed.sql',
  '20260415193505_security_audit_hardening.sql',
  '20260415193755_rls_performance_optimization.sql',
  '20260415200723_20260415_registration_deletion_trigger.sql',
  '20260416150607_fix_vault_create_secret_syntax.sql',
  '20260416152812_add_get_org_smtp_secret_function.sql',
  '20260416185831_fix_handle_registration_deletion_schema.sql',
  '20260419125720_add_event_slug.sql',
  '20260421144601_20260421_multi_waiver_support.sql',
  '20260804231005_parking_registration_extension.sql',
  '20260804231113_revoke_anon_mark_registration_paid.sql',
  '20260805030056_fix_cancel_registration_search_path.sql',
  '20260805030145_fix_registration_cancellation_trigger_search_path.sql',
  '20260805031323_harden_registration_cancellation.sql',
  '20260806001057_restrict_admin_access_to_kentmethodist_org.sql',
  '20260806001318_harden_remaining_admin_functions.sql',
  '20260806001553_require_verified_google_identity_email.sql',
  '20260806054726_tithely_payment_flow.sql',
];

export const BASELINE_MIGRATION = '20260806001553_require_verified_google_identity_email.sql';
export const LATEST_APPLIED_VERSION = '20260806054726';

const MIGRATION_FILENAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const PROJECT_URL = /https:\/\/[a-z0-9]{20}\.supabase\.co\b/;
const JWT_SHAPED_VALUE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const SUPABASE_SECRET_KEY = /sb_secret_/;

function containsExecutableSql(sql) {
  return sql.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('--');
  });
}

export function validateMigrationDirectory(migrationsDirectory, options = {}) {
  const expectedAppliedMigrations = options.expectedAppliedMigrations ?? EXPECTED_APPLIED_MIGRATIONS;
  const latestAppliedVersion = options.latestAppliedVersion ?? LATEST_APPLIED_VERSION;
  const files = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const errors = [];
  const expectedFiles = new Set(expectedAppliedMigrations);
  const baselineMigration = options.baselineMigration
    ?? (expectedAppliedMigrations.includes(BASELINE_MIGRATION)
      ? BASELINE_MIGRATION
      : expectedAppliedMigrations.at(-1));
  const baselineVersion = baselineMigration?.slice(0, 14);
  const expectedMarker = baselineVersion
    ? `-- Applied remotely; represented by the schema baseline in ${baselineVersion}.`
    : null;
  const versionFiles = new Map();

  for (const expectedFilename of expectedAppliedMigrations) {
    if (!files.includes(expectedFilename)) {
      errors.push(`Missing expected migration: ${expectedFilename}`);
    }
  }

  for (const filename of files) {
    const filenameMatch = filename.match(MIGRATION_FILENAME);
    if (!filenameMatch) {
      errors.push(`Invalid migration filename: ${filename}`);
    } else {
      const version = filenameMatch[1];
      const priorFile = versionFiles.get(version);
      if (priorFile) {
        errors.push(`Duplicate migration version ${version}: ${priorFile} and ${filename}`);
      } else {
        versionFiles.set(version, filename);
      }

      if (!expectedFiles.has(filename) && version <= latestAppliedVersion) {
        errors.push(`Unexpected historical migration: ${filename}`);
      }
    }

    const sql = readFileSync(path.join(migrationsDirectory, filename), 'utf8');
    if (PROJECT_URL.test(sql)) {
      errors.push(`${filename}: project-specific Supabase URL found`);
    }
    if (JWT_SHAPED_VALUE.test(sql)) {
      errors.push(`${filename}: JWT-shaped value found`);
    }
    if (SUPABASE_SECRET_KEY.test(sql)) {
      errors.push(`${filename}: Supabase secret key found`);
    }

    if (expectedFiles.has(filename)) {
      if (filename === baselineMigration) {
        if (!containsExecutableSql(sql)) {
          errors.push(`${filename}: baseline must contain executable SQL`);
        }
      } else if (filename < baselineMigration && sql.trim() !== expectedMarker) {
        errors.push(`${filename}: applied history must be a comment-only compatibility marker`);
      } else if (filename > baselineMigration && !containsExecutableSql(sql)) {
        errors.push(`${filename}: applied forward migration must contain executable SQL`);
      }
    }

  }

  return { errors, files };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const migrationsDirectory = path.resolve(path.dirname(thisFile), '..', 'supabase', 'migrations');
  const { errors, files } = validateMigrationDirectory(migrationsDirectory);

  if (errors.length) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Validated ${files.length} Supabase migration files.`);
  }
}
