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
];

export const LATEST_APPLIED_VERSION = '20260806001553';

const MIGRATION_FILENAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const PROJECT_URL = /https:\/\/[a-z0-9]{20}\.supabase\.co\b/;
const JWT_SHAPED_VALUE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const SUPABASE_SECRET_KEY = /sb_secret_/;
const TITHELY_FILENAME = /_tithely_payment_flow\.sql$/;
const SECURITY_INVOKER = /\bSECURITY\s+INVOKER\b/i;
const ORGANIZATION_MEMBERSHIP_CHECK = /\bprivate\s*\.\s*is_org_member\s*\(\s*p_org_id\s*\)/i;
const SUPPORTED_PAYMENT_METHODS = /\bpayment_method\s+IN\s*\(\s*'tithely'\s*,\s*'in_person'\s*\)/i;
const MARK_REGISTRATION_PAID_DECLARATION = /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\s*\.\s*mark_registration_paid\s*\(/i;
const DOLLAR_QUOTE = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g;
const FUNCTION_BODY_START = /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i;

function stripSqlComments(sql) {
  let result = '';
  let quote = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (quote) {
      result += character;
      if (character === quote && nextCharacter === quote) {
        result += nextCharacter;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      result += character;
      continue;
    }

    if (character === '-' && nextCharacter === '-') {
      const lineEnd = sql.indexOf('\n', index + 2);
      if (lineEnd === -1) {
        break;
      }
      result += '\n';
      index = lineEnd;
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      let depth = 1;
      let commentEnd = index + 2;
      while (commentEnd < sql.length && depth > 0) {
        if (sql[commentEnd] === '/' && sql[commentEnd + 1] === '*') {
          depth += 1;
          commentEnd += 2;
        } else if (sql[commentEnd] === '*' && sql[commentEnd + 1] === '/') {
          depth -= 1;
          commentEnd += 2;
        } else {
          commentEnd += 1;
        }
      }
      const comment = sql.slice(index, commentEnd);
      result += comment.replace(/[^\r\n]/g, ' ');
      if (depth > 0) {
        break;
      }
      index = commentEnd - 1;
      continue;
    }

    result += character;
  }

  return result;
}

function hasPaymentMethodAssignment(sql) {
  return sql.split(';').some((statement) => /\bSET\b[\s\S]*?\bpayment_method\s*=/i.test(statement));
}

function maskOrdinaryQuotedStrings(sql, preservePaymentMethodValues = false) {
  let result = '';

  for (let index = 0; index < sql.length; index += 1) {
    const quote = sql[index];
    if (quote !== "'" && quote !== '"') {
      result += quote;
      continue;
    }

    let stringEnd = index + 1;
    while (stringEnd < sql.length) {
      if (sql[stringEnd] === quote && sql[stringEnd + 1] === quote) {
        stringEnd += 2;
      } else if (sql[stringEnd] === quote) {
        stringEnd += 1;
        break;
      } else {
        stringEnd += 1;
      }
    }

    const literal = sql.slice(index, stringEnd);
    const preserveLiteral = preservePaymentMethodValues
      && quote === "'"
      && (literal.toLowerCase() === "'tithely'" || literal.toLowerCase() === "'in_person'");
    result += preserveLiteral ? literal : literal.replace(/[^\r\n]/g, ' ');
    index = stringEnd - 1;
  }

  return result;
}

function maskDollarQuotedBodies(sql) {
  const result = sql.split('');
  DOLLAR_QUOTE.lastIndex = 0;
  let match;
  while ((match = DOLLAR_QUOTE.exec(sql))) {
    const delimiter = match[0];
    const bodyStart = match.index + delimiter.length;
    const bodyEnd = sql.indexOf(delimiter, bodyStart);
    if (bodyEnd === -1) {
      break;
    }
    for (let index = bodyStart; index < bodyEnd; index += 1) {
      if (result[index] !== '\r' && result[index] !== '\n') {
        result[index] = ' ';
      }
    }
    DOLLAR_QUOTE.lastIndex = bodyEnd + delimiter.length;
  }
  return result.join('');
}

function findClosingDollarDelimiter(sql, delimiter, startIndex) {
  let quote = null;

  for (let index = startIndex; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];
    if (quote) {
      if (character === quote && nextCharacter === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (sql.startsWith(delimiter, index)) {
      return index;
    }
  }

  return -1;
}

function extractMarkRegistrationPaidDefinition(sql) {
  const commentlessSql = stripSqlComments(sql);
  const declarationSearch = maskDollarQuotedBodies(maskOrdinaryQuotedStrings(commentlessSql));
  const declarationMatch = MARK_REGISTRATION_PAID_DECLARATION.exec(declarationSearch);
  if (!declarationMatch) {
    return null;
  }

  const declarationStart = declarationMatch.index;
  const bodyStartMatch = FUNCTION_BODY_START.exec(declarationSearch.slice(declarationStart));
  if (!bodyStartMatch) {
    return null;
  }

  const delimiter = bodyStartMatch[1];
  const delimiterStart = declarationStart + bodyStartMatch.index + bodyStartMatch[0].lastIndexOf(delimiter);
  const bodyStart = delimiterStart + delimiter.length;
  const bodyEnd = findClosingDollarDelimiter(commentlessSql, delimiter, bodyStart);
  if (bodyEnd === -1) {
    return null;
  }

  return {
    declaration: commentlessSql.slice(declarationStart, delimiterStart),
    body: commentlessSql.slice(bodyStart, bodyEnd),
  };
}

export function validateMigrationDirectory(migrationsDirectory, options = {}) {
  const expectedAppliedMigrations = options.expectedAppliedMigrations ?? EXPECTED_APPLIED_MIGRATIONS;
  const latestAppliedVersion = options.latestAppliedVersion ?? LATEST_APPLIED_VERSION;
  const files = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const errors = [];
  const expectedFiles = new Set(expectedAppliedMigrations);
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

    if (TITHELY_FILENAME.test(filename)) {
      const functionDefinition = extractMarkRegistrationPaidDefinition(sql);
      if (!functionDefinition) {
        errors.push(`${filename}: Tithe.ly payment flow must define CREATE OR REPLACE FUNCTION public.mark_registration_paid(...)`);
        errors.push(`${filename}: Tithe.ly payment flow must use SECURITY INVOKER`);
        errors.push(`${filename}: Tithe.ly payment flow must call private.is_org_member(p_org_id)`);
        errors.push(`${filename}: Tithe.ly payment flow must support payment_method IN ('tithely', 'in_person')`);
        continue;
      }

      const declaration = maskOrdinaryQuotedStrings(functionDefinition.declaration);
      const body = maskOrdinaryQuotedStrings(functionDefinition.body, true);
      if (!SECURITY_INVOKER.test(declaration)) {
        errors.push(`${filename}: Tithe.ly payment flow must use SECURITY INVOKER`);
      }
      if (!ORGANIZATION_MEMBERSHIP_CHECK.test(body)) {
        errors.push(`${filename}: Tithe.ly payment flow must call private.is_org_member(p_org_id)`);
      }
      if (!SUPPORTED_PAYMENT_METHODS.test(body)) {
        errors.push(`${filename}: Tithe.ly payment flow must support payment_method IN ('tithely', 'in_person')`);
      }
      if (hasPaymentMethodAssignment(body)) {
        errors.push(`${filename}: Tithe.ly payment flow must not assign payment_method in a SET clause`);
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
