# Edge Function Source Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover every active Supabase Edge Function missing from Git and record an enforceable eight-function source/configuration inventory without redeploying or behaviorally changing production.

**Architecture:** Treat the live project as the recovery source only for the five missing slugs. Add a repository inventory contract and per-function configuration, download each missing bundle through the Supabase CLI, commit the recovered files immediately as an immutable baseline, and make no production deployment in this plan.

**Tech Stack:** Supabase CLI 2.111.0, PowerShell, Vitest 4, Node.js filesystem APIs, Git

---

## File Structure

- Create `src/security/__tests__/edgeFunctionInventory.test.js`: repository contract for the eight live slugs, tracked configuration, and baseline metadata.
- Create `supabase/functions/DEPLOYED_BASELINES.md`: human-readable live version, bundle hash, entrypoint, and JWT-verification inventory captured on 2026-08-06.
- Create `supabase/functions/capture-signer-ip/`: exact downloaded version 4 source.
- Create `supabase/functions/send-event-reminders/`: exact downloaded version 2 source.
- Create `supabase/functions/send-registration-email/`: exact downloaded version 7 source.
- Create `supabase/functions/verify-cancel-token/`: exact downloaded version 3 source.
- Create `supabase/functions/weekly-digest/`: exact downloaded version 2 source.
- Modify `supabase/config.toml`: record all eight deployed functions and their current entrypoint/JWT settings.

### Task 1: Add a Failing Repository Inventory Contract

**Files:**
- Create: `src/security/__tests__/edgeFunctionInventory.test.js`

- [ ] **Step 1: Create the inventory test**

```js
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const EXPECTED_FUNCTIONS = Object.freeze({
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
        verifyJwt: false,
        hash: 'f30b5437e47f375a2933e59de9c0fc922e4d2a22126781af37547ef49727ac0e',
    },
    'send-organizer-invite': {
        version: 4,
        verifyJwt: true,
        hash: 'dd8d3785d1d64f87402cf32546d2e27625562678a1e49d6a2321cfa2d62ed576',
    },
    'send-registration-email': {
        version: 7,
        verifyJwt: false,
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
});

const root = process.cwd();
const functionsDirectory = path.resolve(root, 'supabase/functions');
const config = readFileSync(path.resolve(root, 'supabase/config.toml'), 'utf8');
const inventory = readFileSync(
    path.resolve(root, 'supabase/functions/DEPLOYED_BASELINES.md'),
    'utf8'
);

describe('deployed Edge Function source inventory', () => {
    it('tracks exactly the active function slugs', () => {
        const directories = readdirSync(functionsDirectory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
            .map((entry) => entry.name)
            .sort();

        expect(directories).toEqual(Object.keys(EXPECTED_FUNCTIONS).sort());
    });

    it('records every function JWT setting in config.toml', () => {
        for (const [slug, metadata] of Object.entries(EXPECTED_FUNCTIONS)) {
            const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const block = new RegExp(
                `\\[functions\\.${escapedSlug}\\][\\s\\S]*?verify_jwt\\s*=\\s*${metadata.verifyJwt}(?=\\s*\\[|$)`,
                'i'
            );
            expect(config, `missing config for ${slug}`).toMatch(block);
        }
    });

    it('records the live version and bundle hash for every function', () => {
        for (const [slug, metadata] of Object.entries(EXPECTED_FUNCTIONS)) {
            expect(inventory).toContain(`| ${slug} | ${metadata.version} |`);
            expect(inventory).toContain(metadata.hash);
        }
    });
});
```

- [ ] **Step 2: Run the test to verify the recovery gap**

Run:

```powershell
npx vitest run src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1
```

Expected: FAIL because `DEPLOYED_BASELINES.md` and five function directories do not exist and only `submit-registration` currently has a function configuration block.

- [ ] **Step 3: Commit the failing contract**

```powershell
git add -- src/security/__tests__/edgeFunctionInventory.test.js
git commit -m "test: define deployed function inventory"
```

### Task 2: Download and Commit the Five Missing Baselines

**Files:**
- Create: `supabase/functions/DEPLOYED_BASELINES.md`
- Create: `supabase/functions/capture-signer-ip/**`
- Create: `supabase/functions/send-event-reminders/**`
- Create: `supabase/functions/send-registration-email/**`
- Create: `supabase/functions/verify-cancel-token/**`
- Create: `supabase/functions/weekly-digest/**`
- Modify: `supabase/config.toml`
- Test: `src/security/__tests__/edgeFunctionInventory.test.js`

- [ ] **Step 1: Re-read and validate the live inventory before downloading**

Run:

```powershell
$expected = @(
    'capture-signer-ip',
    'resolve-member-email',
    'send-event-reminders',
    'send-organizer-invite',
    'send-registration-email',
    'submit-registration',
    'verify-cancel-token',
    'weekly-digest'
) | Sort-Object
$live = npx supabase functions list --project-ref eonpdgufuewpqdjpshbc --output json | ConvertFrom-Json
$actual = @($live.name | Sort-Object)
if (Compare-Object $expected $actual) {
    throw "Live Edge Function inventory changed; update the approved recovery inventory before continuing."
}
$live | Sort-Object name | Format-Table name, version, status, verify_jwt, ezbr_sha256
```

Expected: eight `ACTIVE` functions with the names, versions, JWT settings, and hashes asserted by the test. Stop if any value differs; do not silently recover an unreviewed revision.

- [ ] **Step 2: Download only the five missing functions**

Run:

```powershell
$missing = @(
    'capture-signer-ip',
    'send-event-reminders',
    'send-registration-email',
    'verify-cancel-token',
    'weekly-digest'
)
foreach ($slug in $missing) {
    npx supabase functions download $slug `
        --project-ref eonpdgufuewpqdjpshbc `
        --use-api `
        --yes
    if ($LASTEXITCODE -ne 0) { throw "Failed to download $slug" }
}
```

Expected: the CLI reports all five slugs downloaded. Existing `resolve-member-email`, `send-organizer-invite`, and `submit-registration` directories remain untouched.

- [ ] **Step 3: Record the current function configuration**

Append these blocks to `supabase/config.toml`, replacing the existing `submit-registration` block rather than duplicating it:

```toml
[functions.capture-signer-ip]
verify_jwt = false

[functions.resolve-member-email]
verify_jwt = true

[functions.send-event-reminders]
verify_jwt = false

[functions.send-organizer-invite]
verify_jwt = true

[functions.send-registration-email]
verify_jwt = false
entrypoint = "./functions/send-registration-email/send-registration-email.ts"

[functions.submit-registration]
verify_jwt = false

[functions.verify-cancel-token]
verify_jwt = false

[functions.weekly-digest]
verify_jwt = false
```

Expected: one configuration block per live slug. The custom registration-email entrypoint is relative to `supabase/config.toml`, as required by current Supabase function configuration.

- [ ] **Step 4: Create the deployed-baseline inventory**

Create `supabase/functions/DEPLOYED_BASELINES.md`:

```markdown
# Deployed Edge Function Baselines

Read from Supabase project `eonpdgufuewpqdjpshbc` on 2026-08-06 with Supabase CLI 2.111.0.

| Function | Version | Verify JWT | Entrypoint | Bundle SHA-256 |
|---|---:|:---:|---|---|
| capture-signer-ip | 4 | false | `index.ts` | `7204504bd31ed1bcec5688a3d787705804dd783ae9d273ab150455d799da0e01` |
| resolve-member-email | 4 | true | `resolve-member-email/index.ts` | `7bfa7ce181214a5315cb98d9b5638d6c2e4ab2f2c088a757a4d651b2c5db5b25` |
| send-event-reminders | 2 | false | `index.ts` | `f30b5437e47f375a2933e59de9c0fc922e4d2a22126781af37547ef49727ac0e` |
| send-organizer-invite | 4 | true | `send-organizer-invite/index.ts` | `dd8d3785d1d64f87402cf32546d2e27625562678a1e49d6a2321cfa2d62ed576` |
| send-registration-email | 7 | false | `send-registration-email.ts` | `ade3a9d9e03ac124dd386cf1d44b599d6f7ad15fe48668ca030a2657d954b397` |
| submit-registration | 1 | false | `supabase/functions/submit-registration/index.ts` | `1091232fc9ce5a44c37f2a77005a0e05d362488f364e197eb79de778da8ccfce` |
| verify-cancel-token | 3 | false | `index.ts` | `2ceefd0a228bbc5179fd97267af88149058b3a0e9af6950e1365458c8a1ffa40` |
| weekly-digest | 2 | false | `index.ts` | `e439e792d708bb5bdf6910a8a7b363716773731016496f39bd55a8852ba25cd9` |

The bundle hash is Supabase deployment metadata, not a hash of an individual downloaded source file. The five missing functions were committed immediately after download. `capture-signer-ip`, `verify-cancel-token`, and `weekly-digest` are recovery-only in the email-message-control project and must not be behaviorally changed or redeployed there.
```

- [ ] **Step 5: Verify only the intended recovery files changed**

Run:

```powershell
git status --short
git diff --name-only -- supabase/functions/resolve-member-email supabase/functions/send-organizer-invite supabase/functions/submit-registration
Get-ChildItem -LiteralPath supabase/functions -Directory |
    Where-Object Name -ne '_shared' |
    Select-Object -ExpandProperty Name |
    Sort-Object
```

Expected: the diff command for the three previously tracked functions prints nothing; the directory list contains exactly the eight approved slugs.

- [ ] **Step 6: Run the inventory contract**

Run:

```powershell
npx vitest run src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 7: Commit the immutable recovery baseline**

```powershell
git add -- supabase/config.toml supabase/functions src/security/__tests__/edgeFunctionInventory.test.js
git commit -m "chore: recover deployed Edge Function sources"
```

- [ ] **Step 8: Prove this plan made no production change**

Run:

```powershell
git show --stat --oneline HEAD
npx supabase functions list --project-ref eonpdgufuewpqdjpshbc --output json
```

Expected: the commit contains only repository files, and live versions remain exactly 4/4/2/4/7/1/3/2. Do not run `supabase functions deploy` in this recovery plan.

## Completion Gate

- Repository and live function slug sets are identical.
- The five formerly missing source bundles are committed.
- The three baseline-only functions have no behavioral diff after their recovery commit.
- No function was invoked, redeployed, deleted, or otherwise changed in production.
- Proceed to `docs/superpowers/plans/2026-08-06-event-email-message-control.md` only from this committed baseline.
