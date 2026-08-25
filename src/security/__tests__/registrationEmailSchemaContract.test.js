import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDirectory = path.resolve(root, 'supabase/migrations');
const functionDirectory = path.resolve(
    root,
    'supabase/functions/send-registration-email'
);
const source = readdirSync(functionDirectory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(path.join(functionDirectory, name), 'utf8'))
    .join('\n');
const baseline = readFileSync(
    path.resolve(
        root,
        'supabase/migrations/20260806001553_require_verified_google_identity_email.sql'
    ),
    'utf8'
);
const migrations = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(path.join(migrationsDirectory, name), 'utf8'))
    .join('\n');

const projection = source.match(
    /\.from\("registrations"\)[\s\S]*?\.select\(\s*"([^"]+)"\s*,?\s*\)/
)?.[1];
const tableBody = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."registrations" \(([\s\S]*?)\n\);/i
)?.[1];

describe('registration email schema contract', () => {
    it('selects only migration-defined registration columns', () => {
        expect(projection, 'registration projection missing').toBeTruthy();
        expect(tableBody, 'registrations table definition missing').toBeTruthy();

        const selected = projection.split(',').map((column) => column.trim());
        const schemaColumns = new Set(
            [...tableBody.matchAll(/^\s*"([^"]+)"\s+/gm)]
                .map((match) => match[1])
        );
        for (const alter of migrations.matchAll(
            /ALTER TABLE\s+(?:"public"\.|public\.)?"?registrations"?([\s\S]*?);/gi
        )) {
            for (const column of alter[1].matchAll(
                /ADD COLUMN(?: IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?/gi
            )) {
                schemaColumns.add(column[1]);
            }
        }

        expect(selected.filter((column) => !schemaColumns.has(column))).toEqual([]);
    });
});
