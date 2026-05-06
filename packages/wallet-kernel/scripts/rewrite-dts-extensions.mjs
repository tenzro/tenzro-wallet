#!/usr/bin/env node
/**
 * Post-build: rewrite `.ts` → `.js` in emitted `.d.ts` and `.d.ts.map` files.
 *
 * TypeScript 5.7's `rewriteRelativeImportExtensions` only rewrites `.js` emit;
 * `.d.ts` emit keeps the source `.ts` suffix (microsoft/TypeScript#61037).
 * Consumers loading the package via `import` need `.js` references in the
 * declaration files for module resolution to succeed.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const RELATIVE_TS_IMPORT = /(from\s+['"]|import\(\s*['"])(\.{1,2}\/[^'"]+?)\.ts(['"])/g;

let touched = 0;
for await (const file of walk(DIST)) {
  if (!file.endsWith('.d.ts') && !file.endsWith('.d.ts.map')) continue;
  const original = await readFile(file, 'utf8');
  const rewritten = original.replace(RELATIVE_TS_IMPORT, '$1$2.js$3');
  if (rewritten !== original) {
    await writeFile(file, rewritten);
    touched += 1;
  }
}

console.log(`rewrite-dts-extensions: rewrote ${touched} file(s)`);
