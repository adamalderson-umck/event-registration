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
