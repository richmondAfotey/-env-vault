/**
 * Wraps the bundled CLI into a platform-native single executable (Node SEA).
 *
 * Usage: node scripts/sea.mjs <output-binary>
 * Requires `npm run build` and `npm run bundle` to have run first.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const postject = require('postject');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const outName = process.argv[2];
if (!outName) {
  console.error('Usage: node scripts/sea.mjs <output-binary>');
  process.exit(2);
}
const outPath = path.resolve(outName);

const bundlePath = path.join(ROOT, 'dist', 'env-vault.bundle.js');
if (!existsSync(bundlePath)) {
  console.error(
    `Missing ${bundlePath}. Run \`npm run build && npm run bundle\` first.`,
  );
  process.exit(2);
}

const seaConfig = path.join(ROOT, 'sea-config.json');
execFileSync(
  process.execPath,
  ['--experimental-sea-config', seaConfig],
  { stdio: 'inherit' },
);

// A single-file executable is Node itself with the blob injected.
copyFileSync(process.execPath, outPath);
if (process.platform === 'darwin') {
  // The copy inherits Node's code signature, which an injected blob breaks.
  execFileSync('codesign', ['--remove-signature', outPath], {
    stdio: 'ignore',
  });
}

postject.inject(outPath, 'NODE_SEA_BLOB', readFileSync(path.join(ROOT, 'dist', 'sea-prep.blob')), {
  sentinelFuse: SENTINEL_FUSE,
  macho: false,
});

console.log(`* Built single-file executable: ${outPath}`);