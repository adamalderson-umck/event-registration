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
