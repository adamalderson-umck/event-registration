import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const DEPLOYED_FUNCTIONS = Object.freeze({
    'capture-signer-ip': {
        version: 4,
        verifyJwt: false,
        hash: '7204504bd31ed1bcec5688a3d787705804dd783ae9d273ab150455d799da0e01',
    },
    'resolve-member-email': {
        version: 4,
        verifyJwt: true,
        hash: '7bfa7ce181214a5315cb98d9b5638d6c2e4ab2f2c088a757a4d651b2c5db5b25',
    },
    'send-event-reminders': {
        version: 2,
        verifyJwt: true,
        hash: 'f30b5437e47f375a2933e59de9c0fc922e4d2a22126781af37547ef49727ac0e',
    },
    'send-organizer-invite': {
        version: 4,
        verifyJwt: true,
        hash: 'dd8d3785d1d64f87402cf32546d2e27625562678a1e49d6a2321cfa2d62ed576',
    },
    'send-registration-email': {
        version: 7,
        verifyJwt: true,
        hash: 'ade3a9d9e03ac124dd386cf1d44b599d6f7ad15fe48668ca030a2657d954b397',
    },
    'submit-registration': {
        version: 1,
        verifyJwt: false,
        hash: '1091232fc9ce5a44c37f2a77005a0e05d362488f364e197eb79de778da8ccfce',
    },
    'verify-cancel-token': {
        version: 3,
        verifyJwt: false,
        hash: '2ceefd0a228bbc5179fd97267af88149058b3a0e9af6950e1365458c8a1ffa40',
    },
    'weekly-digest': {
        version: 2,
        verifyJwt: false,
        hash: 'e439e792d708bb5bdf6910a8a7b363716773731016496f39bd55a8852ba25cd9',
    },
    'update-registration-answers': {
        version: 1,
        verifyJwt: true,
        hash: '334319f520d556bf8808fd756209ed0d0f1bb46f5f338b6bef9148ddfdf4c383',
    },
});

const PENDING_DEPLOYMENT_FUNCTIONS = Object.freeze({});

const SOURCE_FUNCTIONS = Object.freeze({
    ...DEPLOYED_FUNCTIONS,
    ...PENDING_DEPLOYMENT_FUNCTIONS,
});

const root = process.cwd();
const functionsDirectory = path.resolve(root, 'supabase/functions');
const config = readFileSync(path.resolve(root, 'supabase/config.toml'), 'utf8');
const inventory = readFileSync(
    path.resolve(root, 'supabase/functions/DEPLOYED_BASELINES.md'),
    'utf8'
);

describe('Edge Function source and deployment inventory', () => {
    it('tracks exactly the source function slugs', () => {
        const directories = readdirSync(functionsDirectory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
            .map((entry) => entry.name)
            .sort();

        expect(directories).toEqual(Object.keys(SOURCE_FUNCTIONS).sort());
    });

    it('records every source function JWT setting in config.toml', () => {
        for (const [slug, metadata] of Object.entries(SOURCE_FUNCTIONS)) {
            const header = `[functions.${slug}]`;
            const blockStart = config.indexOf(header);
            const nextSection = config.indexOf('\n[', blockStart + header.length);
            const block = blockStart === -1
                ? ''
                : config.slice(blockStart, nextSection === -1 ? undefined : nextSection);

            expect(block, `missing config for ${slug}`).toMatch(
                new RegExp(`verify_jwt\\s*=\\s*${metadata.verifyJwt}`, 'i')
            );
        }
    });

    it('records the live version and bundle hash for every deployed function', () => {
        for (const [slug, metadata] of Object.entries(DEPLOYED_FUNCTIONS)) {
            expect(inventory).toContain(`| ${slug} | ${metadata.version} |`);
            expect(inventory).toContain(metadata.hash);
        }
    });
});
