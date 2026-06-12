import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Root config: `npm test` runs `vitest run` from here and discovers tests across all
// workspaces. Resolve workspace packages to their TypeScript source. Their published entry
// points at built `dist/` (gitignored), which does not exist on a fresh checkout or in the
// CI test job (no build step before `npm test`). Aliasing to `src` keeps `npm test`
// self-contained and runs against the source of truth.
const fromHere = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  test: {
    // Vitest's default exclude does not cover dist/.next. Without this, a stale compiled
    // test left in a local dist/ (e.g. dist/**/*.test.js) runs as a duplicate, so local
    // counts drift from CI (which has no build before tests). Run source tests only.
    exclude: [...configDefaults.exclude, '**/dist/**', '**/.next/**'],
  },
  resolve: {
    alias: {
      '@mat-inspect/shared-schemas': fromHere('packages/shared-schemas/src/index.ts'),
      '@mat-inspect/shared-types': fromHere('packages/shared-types/src/index.ts'),
    },
  },
});
