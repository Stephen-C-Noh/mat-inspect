import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Root config: `npm test` runs `vitest run` from here and discovers tests across all
// workspaces. Resolve workspace packages to their TypeScript source. Their published entry
// points at built `dist/` (gitignored), which does not exist on a fresh checkout or in the
// CI test job (no build step before `npm test`). Aliasing to `src` keeps `npm test`
// self-contained and runs against the source of truth.
const fromHere = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@mat-inspect/shared-schemas': fromHere('packages/shared-schemas/src/index.ts'),
      '@mat-inspect/shared-types': fromHere('packages/shared-types/src/index.ts'),
    },
  },
});
