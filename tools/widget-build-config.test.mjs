// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import viteConfig from '../vite.config.js';

const firebaseConfig = JSON.parse(
  readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'),
);
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
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

  it('runs the cache validator after every production build', () => {
    expect(packageJson.scripts['check:widget-cache']).toBe(
      'node tools/check-widget-cache-contract.mjs',
    );
    expect(packageJson.scripts.build).toBe(
      'vite build && npm run check:widget-cache',
    );
  });
});
