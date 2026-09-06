/**
 * `env-vault init` — establish the safe baseline.
 *
 *  1. Mkdir `.envvault/`
 *  2. Append/refresh the `.gitignore` rules (secrets ignored, encrypted
 *     vaults + `.env.example` tracked)
 *  3. Create `.env.example` if missing
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { VAULT_DIR_NAME, Vault } from '../storage/vault.js';

/** Normalized env-vault gitignore rules, kept in step with `.gitignore`. */
export const GITIGNORE_BLOCK = `# env-vault
.env*
!.envvault/
!.envvault/*.enc
!.env.example
`;

const ENV_EXAMPLE = `# env-vault example file -- NEVER store real secrets here.
# Real secrets live in encrypted vaults under .envvault/ and are created with:
#
#   env-vault set KEY=value --profile development
#
# List the variables your app expects; keep the values safe (or empty).

DATABASE_URL=postgres://localhost:5432/myapp
API_KEY=changeme
LOG_LEVEL=info
`;

export function init(root: string = process.cwd()): void {
  const vault = new Vault(root);
  vault.ensureVaultDir();
  console.log(`* Initialized ${VAULT_DIR_NAME}/`);

  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (existing.includes(GITIGNORE_BLOCK)) {
      console.log('* .gitignore already has env-vault rules (no change)');
    } else {
      const separator = existing.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}${GITIGNORE_BLOCK}\n`);
      console.log('* Appended env-vault rules to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, GITIGNORE_BLOCK);
    console.log('* Created .gitignore with env-vault rules');
  }

  const examplePath = path.join(root, '.env.example');
  if (fs.existsSync(examplePath)) {
    console.log('* .env.example exists (no change)');
  } else {
    fs.writeFileSync(examplePath, ENV_EXAMPLE);
    console.log('* Created .env.example');
  }

  console.log('');
  console.log('env-vault is ready. Add a secret with:');
  console.log('  env-vault set KEY=VALUE --profile development');
}