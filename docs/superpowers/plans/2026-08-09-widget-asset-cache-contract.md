# Widget Asset Cache Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the stable WordPress widget entry URLs while preventing browsers from combining JavaScript modules from different deployments.

**Architecture:** Vite keeps the public JavaScript and CSS entry filenames stable, but emits lazy chunks and dependent assets under `assets/versioned/` with content hashes. Firebase revalidates the two stable files and applies one-year immutable caching only to the versioned directory. A repository-owned Node validator checks both built output and Firebase headers, and the normal build command runs that validator.

**Tech Stack:** Vite 7, Rollup output naming, Firebase Hosting headers, Node.js 24, Vitest 4, npm scripts.

---

## File Structure

- Create `tools/check-widget-cache-contract.mjs` — validate built asset paths, entry imports, and Firebase cache headers; expose a testable function and a CLI.
- Create `tools/check-widget-cache-contract.test.mjs` — exercise valid and invalid cache-contract fixtures without running Vite.
- Create `tools/widget-build-config.test.mjs` — lock the Vite output naming, Firebase header rules, and npm build-gate wiring.
- Modify `vite.config.js` — retain stable embed entries and hash all dependent output under `assets/versioned/`.
- Modify `firebase.json` — replace the blanket immutable asset rule with three non-overlapping cache rules.
- Modify `package.json` — add the checker command and run it after every production build.

### Task 1: Add a testable widget cache-contract validator

**Files:**
- Create: `tools/check-widget-cache-contract.test.mjs`
- Create: `tools/check-widget-cache-contract.mjs`

- [ ] **Step 1: Write the validator fixture tests**

Create `tools/check-widget-cache-contract.test.mjs`:

```js
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { validateWidgetCacheContract } from './check-widget-cache-contract.mjs';

const temporaryDirectories = [];

const validFirebaseConfig = () => ({
  hosting: {
    headers: [
      {
        source: '**',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
      {
        source: '/assets/events-widget.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/assets/events-style.css',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/assets/versioned/**',
        headers: [{
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        }],
      },
      {
        source: 'index.html',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ],
  },
});

function createDist(files = {}) {
  const directory = mkdtempSync(path.join(process.env.TEMP || process.cwd(), 'widget-cache-'));
  temporaryDirectories.push(directory);

  const defaults = {
    'assets/events-widget.js': 'import("./versioned/events-widget-RegistrationViewer-Ab12Cd34.js")',
    'assets/events-style.css': 'body { color: black; }',
    'assets/versioned/events-widget-RegistrationViewer-Ab12Cd34.js': 'export default function Viewer() {}',
    'assets/versioned/source-sans-3-Xy98Za76.woff2': 'font',
  };

  for (const [relativePath, contents] of Object.entries({ ...defaults, ...files })) {
    const filePath = path.join(directory, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }

  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('validateWidgetCacheContract', () => {
  it('accepts stable revalidated entries and hashed immutable dependencies', () => {
    const result = validateWidgetCacheContract({
      distDirectory: createDist(),
      firebaseConfig: validFirebaseConfig(),
    });

    expect(result.errors).toEqual([]);
    expect(result.files).toContain('assets/events-widget.js');
  });

  it('rejects missing stable entries and unversioned JavaScript chunks', () => {
    const directory = createDist({
      'assets/events-widget-RegistrationViewer.js': 'export default function Viewer() {}',
    });
    rmSync(path.join(directory, 'assets', 'events-style.css'));

    const { errors } = validateWidgetCacheContract({
      distDirectory: directory,
      firebaseConfig: validFirebaseConfig(),
    });

    expect(errors).toContain('Missing stable widget asset: assets/events-style.css');
    expect(errors).toContain(
      'JavaScript chunk must be versioned: assets/events-widget-RegistrationViewer.js',
    );
  });

  it('rejects unhashed files in the versioned directory', () => {
    const { errors } = validateWidgetCacheContract({
      distDirectory: createDist({
        'assets/versioned/logo.svg': '<svg></svg>',
      }),
      firebaseConfig: validFirebaseConfig(),
    });

    expect(errors).toContain('Versioned asset must contain a content hash: assets/versioned/logo.svg');
  });

  it('rejects an entry bundle that references an unversioned lazy chunk', () => {
    const { errors } = validateWidgetCacheContract({
      distDirectory: createDist({
        'assets/events-widget.js': 'import("./events-widget-RegistrationViewer.js")',
      }),
      firebaseConfig: validFirebaseConfig(),
    });

    expect(errors).toContain(
      'Stable entry references an unversioned JavaScript chunk: assets/events-widget-RegistrationViewer.js',
    );
  });

  it('rejects blanket immutable caching and missing stable revalidation rules', () => {
    const firebaseConfig = validFirebaseConfig();
    firebaseConfig.hosting.headers = firebaseConfig.hosting.headers
      .filter(rule => rule.source !== '/assets/events-widget.js');
    firebaseConfig.hosting.headers.push({
      source: '/assets/**',
      headers: [{
        key: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      }],
    });

    const { errors } = validateWidgetCacheContract({
      distDirectory: createDist(),
      firebaseConfig,
    });

    expect(errors).toContain(
      'Expected /assets/events-widget.js to use Cache-Control: no-cache',
    );
    expect(errors).toContain('Blanket immutable caching for /assets/** is not allowed');
  });
});
```

- [ ] **Step 2: Run the test and verify the test seam initially errors**

Run:

```powershell
npm run test:run -- tools/check-widget-cache-contract.test.mjs --reporter=verbose
```

Expected: FAIL because `tools/check-widget-cache-contract.mjs` does not exist.

- [ ] **Step 3: Add the validator API shell and re-run for a behavioral red result**

Create `tools/check-widget-cache-contract.mjs` with the public seam only:

```js
export function validateWidgetCacheContract() {
  return { errors: ['Widget cache contract validation is not implemented.'], files: [] };
}
```

Run:

```powershell
npm run test:run -- tools/check-widget-cache-contract.test.mjs --reporter=verbose
```

Expected: FAIL because the valid fixture receives the deliberate `not implemented` error and invalid fixtures do not receive their specific messages.

- [ ] **Step 4: Implement the minimal validator and CLI**

Replace `tools/check-widget-cache-contract.mjs` with:

```js
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE_ASSETS = [
  'assets/events-widget.js',
  'assets/events-style.css',
];
const VERSIONED_PREFIX = 'assets/versioned/';
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[^/]+$/;
const JAVASCRIPT_REFERENCE = /(?:\.\/)?((?:assets\/)?versioned\/[^"'`]+\.js|events-widget-[^"'`]+\.js)/g;
const IMMUTABLE = 'public, max-age=31536000, immutable';

function listFiles(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(absolutePath, root);
      return path.relative(root, absolutePath).split(path.sep).join('/');
    })
    .sort();
}

function cacheControlFor(firebaseConfig, source) {
  const rule = firebaseConfig?.hosting?.headers?.find(item => item.source === source);
  const header = rule?.headers?.find(item => item.key.toLowerCase() === 'cache-control');
  return header?.value;
}

function normalizeReference(reference) {
  if (reference.startsWith('assets/')) return reference;
  if (reference.startsWith('versioned/')) return `assets/${reference}`;
  return `assets/${reference}`;
}

export function validateWidgetCacheContract({ distDirectory, firebaseConfig }) {
  const files = listFiles(distDirectory);
  const errors = [];

  for (const stableAsset of STABLE_ASSETS) {
    if (!files.includes(stableAsset)) {
      errors.push(`Missing stable widget asset: ${stableAsset}`);
    }
  }

  for (const file of files) {
    if (file.endsWith('.js')
      && file !== 'assets/events-widget.js'
      && !file.startsWith(VERSIONED_PREFIX)) {
      errors.push(`JavaScript chunk must be versioned: ${file}`);
    }
    if (file.startsWith(VERSIONED_PREFIX) && !HASHED_ASSET.test(file)) {
      errors.push(`Versioned asset must contain a content hash: ${file}`);
    }
  }

  const entryPath = path.join(distDirectory, 'assets', 'events-widget.js');
  if (files.includes('assets/events-widget.js')) {
    const entrySource = readFileSync(entryPath, 'utf8');
    for (const match of entrySource.matchAll(JAVASCRIPT_REFERENCE)) {
      const reference = normalizeReference(match[1]);
      if (reference !== 'assets/events-widget.js'
        && !reference.startsWith(VERSIONED_PREFIX)) {
        errors.push(`Stable entry references an unversioned JavaScript chunk: ${reference}`);
      }
    }
  }

  for (const stableAsset of STABLE_ASSETS) {
    const source = `/${stableAsset}`;
    if (cacheControlFor(firebaseConfig, source) !== 'no-cache') {
      errors.push(`Expected ${source} to use Cache-Control: no-cache`);
    }
  }

  if (cacheControlFor(firebaseConfig, '/assets/versioned/**') !== IMMUTABLE) {
    errors.push(`Expected /assets/versioned/** to use Cache-Control: ${IMMUTABLE}`);
  }
  if (cacheControlFor(firebaseConfig, 'index.html') !== 'no-cache') {
    errors.push('Expected index.html to use Cache-Control: no-cache');
  }
  if (cacheControlFor(firebaseConfig, '/assets/**')?.includes('immutable')) {
    errors.push('Blanket immutable caching for /assets/** is not allowed');
  }

  return { errors, files };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const repositoryRoot = path.resolve(path.dirname(thisFile), '..');
  const distDirectory = path.join(repositoryRoot, 'dist');
  const firebaseConfig = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'firebase.json'), 'utf8'),
  );
  const { errors, files } = validateWidgetCacheContract({
    distDirectory,
    firebaseConfig,
  });

  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Validated widget cache contract across ${files.length} built files.`);
  }
}
```

- [ ] **Step 5: Run the validator tests and verify green**

Run:

```powershell
npm run test:run -- tools/check-widget-cache-contract.test.mjs --reporter=verbose
```

Expected: 5 tests pass and 0 fail.

- [ ] **Step 6: Commit the validator**

```powershell
git add -- tools/check-widget-cache-contract.mjs tools/check-widget-cache-contract.test.mjs
git commit -m "test: add widget cache contract validator"
```

### Task 2: Change the Vite and Firebase cache contracts

**Files:**
- Create: `tools/widget-build-config.test.mjs`
- Modify: `vite.config.js:11-23`
- Modify: `firebase.json:15-31`

- [ ] **Step 1: Write the failing configuration contract tests**

Create `tools/widget-build-config.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import viteConfig from '../vite.config.js';

const firebaseConfig = JSON.parse(
  readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'),
);

function cacheControlFor(source) {
  const rule = firebaseConfig.hosting.headers.find(item => item.source === source);
  return rule?.headers.find(item => item.key === 'Cache-Control')?.value;
}

describe('widget build cache configuration', () => {
  it('keeps embed entries stable and hashes every dependent asset', () => {
    const output = viteConfig.build.rollupOptions.output;

    expect(output.entryFileNames).toBe('assets/events-widget.js');
    expect(output.chunkFileNames).toBe(
      'assets/versioned/events-widget-[name]-[hash].js',
    );
    expect(output.assetFileNames({ name: 'index.css' })).toBe('assets/events-style.css');
    expect(output.assetFileNames({ name: 'logo.svg' })).toBe(
      'assets/versioned/[name]-[hash][extname]',
    );
  });

  it('revalidates stable entries and caches only versioned assets as immutable', () => {
    expect(cacheControlFor('/assets/events-widget.js')).toBe('no-cache');
    expect(cacheControlFor('/assets/events-style.css')).toBe('no-cache');
    expect(cacheControlFor('/assets/versioned/**')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('/assets/**')).toBeUndefined();
    expect(cacheControlFor('index.html')).toBe('no-cache');
  });
});
```

- [ ] **Step 2: Run the configuration tests and verify red**

Run:

```powershell
npm run test:run -- tools/widget-build-config.test.mjs --reporter=verbose
```

Expected: FAIL because chunks and assets are not hashed under `assets/versioned/`, the stable entries lack exact revalidation rules, and `/assets/**` is immutable.

- [ ] **Step 3: Implement the Vite output contract**

Replace the `output` block in `vite.config.js` with:

```js
output: {
  // WordPress references these two stable entry filenames directly.
  entryFileNames: 'assets/events-widget.js',
  chunkFileNames: 'assets/versioned/events-widget-[name]-[hash].js',
  assetFileNames: (assetInfo) => {
    if (assetInfo.name && assetInfo.name.endsWith('.css')) {
      return 'assets/events-style.css';
    }
    return 'assets/versioned/[name]-[hash][extname]';
  },
},
```

- [ ] **Step 4: Implement the Firebase header contract**

Replace the `/assets/**` header rule in `firebase.json` with these three rules:

```json
{
  "source": "/assets/events-widget.js",
  "headers": [
    { "key": "Cache-Control", "value": "no-cache" }
  ]
},
{
  "source": "/assets/events-style.css",
  "headers": [
    { "key": "Cache-Control", "value": "no-cache" }
  ]
},
{
  "source": "/assets/versioned/**",
  "headers": [
    { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
  ]
}
```

- [ ] **Step 5: Run the configuration tests and verify green**

Run:

```powershell
npm run test:run -- tools/widget-build-config.test.mjs --reporter=verbose
```

Expected: 2 tests pass and 0 fail.

- [ ] **Step 6: Build once and run the checker directly**

Run:

```powershell
$env:VITE_SUPABASE_URL='https://placeholder.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='placeholder-anon-key'
npx vite build
node tools/check-widget-cache-contract.mjs
```

Expected: Vite emits the two stable files plus hashed files under `dist/assets/versioned/`; the checker exits 0 and reports the number of validated built files.

- [ ] **Step 7: Commit the build and hosting contract**

```powershell
git add -- vite.config.js firebase.json tools/widget-build-config.test.mjs
git commit -m "fix: version widget dependency assets"
```

### Task 3: Enforce the contract through the normal build command

**Files:**
- Modify: `tools/widget-build-config.test.mjs`
- Modify: `package.json:6-18`

- [ ] **Step 1: Extend the test with the required npm scripts**

Add this import and test to `tools/widget-build-config.test.mjs`:

```js
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

it('runs the cache validator after every production build', () => {
  expect(packageJson.scripts['check:widget-cache']).toBe(
    'node tools/check-widget-cache-contract.mjs',
  );
  expect(packageJson.scripts.build).toBe(
    'vite build && npm run check:widget-cache',
  );
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```powershell
npm run test:run -- tools/widget-build-config.test.mjs --reporter=verbose
```

Expected: FAIL because `check:widget-cache` is absent and `build` runs only Vite.

- [ ] **Step 3: Add the npm build gate**

Update the relevant `package.json` scripts to:

```json
"build": "vite build && npm run check:widget-cache",
"check:widget-cache": "node tools/check-widget-cache-contract.mjs",
```

Keep the existing `deploy` and `deploy:preview` scripts unchanged; both already invoke `npm run build` before Firebase deployment.

- [ ] **Step 4: Run the configuration test and full gated build**

Run:

```powershell
npm run test:run -- tools/widget-build-config.test.mjs --reporter=verbose
$env:VITE_SUPABASE_URL='https://placeholder.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='placeholder-anon-key'
npm run build
```

Expected: 3 tests pass; Vite succeeds; `check:widget-cache` exits 0 after the build.

- [ ] **Step 5: Commit the build gate**

```powershell
git add -- package.json tools/widget-build-config.test.mjs
git commit -m "build: enforce widget cache contract"
```

### Task 4: Verify the complete branch

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Verify the focused tests serially**

Run:

```powershell
npm run test:run -- tools/check-widget-cache-contract.test.mjs tools/widget-build-config.test.mjs --reporter=verbose --maxWorkers=1
```

Expected: 2 test files pass, 8 tests pass, 0 fail.

- [ ] **Step 2: Verify migration history and lint**

Run:

```powershell
npm run check:migrations
npm run lint
```

Expected: migration validation exits 0; ESLint exits 0 with no errors.

- [ ] **Step 3: Run the complete test suite serially**

Run:

```powershell
npm run test -- --run --reporter=verbose --maxWorkers=1
```

Expected: all test files and tests pass with 0 failures.

- [ ] **Step 4: Run the gated production build**

Run:

```powershell
$env:VITE_SUPABASE_URL='https://placeholder.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='placeholder-anon-key'
npm run build
```

Expected: Vite succeeds and the final line reports successful widget cache-contract validation.

- [ ] **Step 5: Inspect the output and branch scope**

Run:

```powershell
rg --files dist/assets
git diff --check origin/main...HEAD
git status --short --branch
```

Expected:

- `dist/assets/events-widget.js` and `dist/assets/events-style.css` exist.
- Every other emitted asset is under `dist/assets/versioned/` and contains a hash.
- `git diff --check` emits no errors.
- The worktree is clean and the branch contains only the design, validator, cache configuration, build gate, and their tests.
