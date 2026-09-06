/**
 * Bundles the CLI into a single self-contained ESM file for Node SEA binaries
 * (esbuild; dev dependency only — the released npm package stays un-bundled).
 * Injects the package version so `--version` works inside a binary.
 *
 * Usage: npm run bundle
 */
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  // Node SEA loads its embedded main as CommonJS, so the binary bundle must
  // be CJS (esbuild rewrites `import.meta.url` for CJS automatically).
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/env-vault.bundle.js',
  define: {
    __ENV_VAULT_VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: 'info',
});

console.log(`* Bundled dist/env-vault.bundle.js (version ${pkg.version})`);