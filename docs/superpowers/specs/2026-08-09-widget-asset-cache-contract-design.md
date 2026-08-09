# Widget Asset Cache Contract Design

## Problem

The production widget currently publishes every build artifact at a stable URL while Firebase serves every `/assets/**` response with `Cache-Control: public, max-age=31536000, immutable`.

That allows a browser to retain files from different deployments independently. A cached August 5 parking-registration chunk combined with a later `events-widget.js` reproduces the production failure exactly:

```text
TypeError: Es is not a function
events-widget-RegistrationViewer.js:120:68678
```

The old chunk calls the main bundle's minified export slot as `formatPaymentSummary`; a later main bundle assigns that slot differently. Coherent builds render the same parking registration successfully.

## Goals

- Preserve the two URLs used by the WordPress embed:
  - `/assets/events-widget.js`
  - `/assets/events-style.css`
- Ensure those stable files are revalidated instead of retained indefinitely.
- Give every lazy JavaScript chunk and dependent asset a content-addressed URL.
- Keep long-lived immutable caching for content-addressed files.
- Fail local and CI builds when the build output or Firebase headers violate this contract.

## Non-goals

- Change the WordPress embed markup.
- Change application, registration, payment, database, or authentication behavior.
- Add service workers or runtime cache recovery.
- Deploy or modify production as part of the implementation branch.

## Considered Approaches

### 1. Stable revalidated entry files plus hashed dependencies

Keep the externally referenced JavaScript and CSS filenames stable. Emit all files they depend on into a versioned directory with content hashes. Revalidate only the stable files and cache only the versioned directory as immutable.

This is the selected approach. It preserves the embed contract, prevents cross-generation module imports, and retains efficient caching.

### 2. Disable caching for every asset

This prevents stale combinations but needlessly re-downloads large chunks, fonts, and images whose content can be addressed safely by a hash.

### 3. Add a release query string to stable URLs

This requires changing every embed for every release and does not create a durable contract for lazy imports. It is rejected.

## Build Output Contract

Vite will emit:

- Entry JavaScript: `assets/events-widget.js`
- Compiled stylesheet: `assets/events-style.css`
- Lazy JavaScript chunks: `assets/versioned/events-widget-[name]-[hash].js`
- Fonts, images, and other emitted assets: `assets/versioned/[name]-[hash][extname]`

The stable entry bundle will therefore reference a deployment-specific set of hashed lazy chunks. Revalidating the entry bundle gives a browser one coherent import graph; unchanged hashed files can remain cached indefinitely.

The public embed example continues to reference the same JavaScript and CSS URLs.

## Firebase Cache Contract

The current blanket `/assets/**` immutable rule will be removed. The replacement rules will be non-overlapping:

- `/assets/events-widget.js`: `Cache-Control: no-cache`
- `/assets/events-style.css`: `Cache-Control: no-cache`
- `/assets/versioned/**`: `Cache-Control: public, max-age=31536000, immutable`

The existing site-wide security headers remain unchanged. `index.html` remains `no-cache`.

No unversioned asset path receives an immutable cache policy.

## Contract Validation

A repository-owned Node checker will run against the production build output and Firebase configuration. It will fail when any of these invariants is broken:

- Either stable embed file is missing.
- A lazy JavaScript chunk is emitted outside `assets/versioned/`.
- A versioned JavaScript chunk or dependent asset lacks a content hash.
- The entry bundle references an unversioned lazy chunk.
- Firebase marks either stable embed file immutable.
- Firebase does not mark `assets/versioned/**` immutable.
- A blanket immutable `/assets/**` rule is reintroduced.

The normal build command will run the checker after Vite so local builds, CI builds, and the existing deploy command share the same gate.

Tests for the checker will cover both the accepted contract and representative failure states before the production configuration is changed.

## Rollout and Recovery

The first deployment with this contract publishes a revalidated stable entry file that points to newly hashed dependencies. Existing browsers may still retain the previously immutable stable files until users hard-refresh or clear site data once. After that transition, subsequent deployments cannot create the same cross-generation pairing.

The implementation will not deploy. Publishing and production verification require a separate explicit instruction.
