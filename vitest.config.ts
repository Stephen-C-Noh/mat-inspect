import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

// Root config: `npm test` runs `vitest run` from here and discovers tests across all
// workspaces. Resolve workspace packages to their TypeScript source. Their published entry
// points at built `dist/` (gitignored), which does not exist on a fresh checkout or in the
// CI test job (no build step before `npm test`). Aliasing to `src` keeps `npm test`
// self-contained and runs against the source of truth.
const fromHere = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const sharedPackageAlias = {
  '@mat-inspect/shared-auth': fromHere('packages/shared-auth/src/index.ts'),
  '@mat-inspect/shared-auth-server': fromHere('packages/shared-auth-server/src/index.ts'),
  '@mat-inspect/shared-crypto': fromHere('packages/shared-crypto/src/index.ts'),
  '@mat-inspect/shared-schemas': fromHere('packages/shared-schemas/src/index.ts'),
  '@mat-inspect/shared-types': fromHere('packages/shared-types/src/index.ts'),
};

// Vitest's default exclude does not cover dist/.next. Without this, a stale compiled
// test left in a local dist/ (e.g. dist/**/*.test.js) runs as a duplicate, so local
// counts drift from CI (which has no build before tests). Run source tests only.
const exclude = [...configDefaults.exclude, '**/dist/**', '**/.next/**'];

// Both apps map `@/*` to their own src, so the alias cannot be global: one project per app
// keeps `@/components/...` resolving to the right app. Everything else (services, packages, db)
// needs no app alias and stays in one project.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: { ...sharedPackageAlias, '@/': `${fromHere('apps/pwa/src')}/` } },
        test: {
          name: 'pwa',
          include: ['apps/pwa/**/*.test.{ts,tsx}'],
          exclude,
          // Node by default: most PWA tests are pure modules. A component test opts in per file
          // with `// @vitest-environment jsdom`, so jsdom is not paid for on every file.
          environment: 'node',
        },
      },
      {
        resolve: { alias: sharedPackageAlias },
        test: {
          name: 'root',
          exclude: [...exclude, 'apps/pwa/**'],
        },
      },
    ],
  },
});
