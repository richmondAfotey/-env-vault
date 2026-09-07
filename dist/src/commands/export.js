/**
 * `env-vault export --profile <name> --out <file> [--force]`
 *
 * The one command that intentionally writes PLAIN-TEXT secrets to disk.
 * Guarded by a loud warning + typed confirmation unless `--force` is given.
 * Intended only for legacy local debugging.
 */
import * as path from 'node:path';
import { ProfileNotFoundError, UsageError, red, bold } from '../utils/errors.js';
import { promptConfirm, promptPassword } from '../utils/prompt.js';
import { Vault, atomicWrite } from '../storage/vault.js';
export async function exportCommand(opts, root = process.cwd()) {
    const outFile = opts.out;
    if (!outFile) {
        throw new UsageError('Usage: env-vault export [--profile name] --out <file> [--force]');
    }
    const vault = new Vault(root);
    const profile = opts.profile ?? vault.readActiveProfile();
    if (!vault.hasProfile(profile)) {
        throw new ProfileNotFoundError(profile);
    }
    if (!opts.force) {
        console.warn(red(bold('WARNING: this writes PLAIN-TEXT secrets to disk, visible to anyone')));
        console.warn(red(bold('with read access to the output file.')));
        console.warn(red('Only use this for legacy local debugging.'));
        const ok = await promptConfirm("Type 'yes' to continue: ");
        if (!ok) {
            console.log('Aborted.');
            return;
        }
    }
    const password = await promptPassword('Master password: ');
    if (password.length === 0) {
        throw new UsageError('Master password cannot be empty.');
    }
    const secrets = vault.readProfile(profile, password);
    const entries = Object.keys(secrets)
        .sort()
        .map((k) => `${k}=${secrets[k]}`);
    atomicWrite(path.resolve(root, outFile), entries.join('\n') + '\n');
    console.log(`* Exported ${entries.length} variable(s) from profile '${profile}' to ${outFile}`);
    console.warn(red('Reminder: that file contains PLAIN-TEXT secrets.'));
}
