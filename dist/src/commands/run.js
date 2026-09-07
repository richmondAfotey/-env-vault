/**
 * `env-vault run -- <command> [args...]` — inject secrets in-memory.
 *
 * Decrypts the active profile, then spawns the command with the secrets merged
 * over the current environment. Nothing is written to disk; the secrets exist
 * only in the child process's memory for the lifetime of the run.
 */
import { ProfileNotFoundError, UsageError } from '../utils/errors.js';
import { promptPassword } from '../utils/prompt.js';
import { spawnWithEnv } from '../utils/process.js';
import { Vault } from '../storage/vault.js';
export async function runCommand(runArgs, root = process.cwd()) {
    if (runArgs.length === 0) {
        throw new UsageError('Usage: env-vault run -- <command> [args...]');
    }
    const command = runArgs[0];
    if (!command) {
        throw new UsageError('Usage: env-vault run -- <command> [args...]');
    }
    const args = runArgs.slice(1);
    const vault = new Vault(root);
    const profile = vault.readActiveProfile();
    if (!vault.hasProfile(profile)) {
        throw new ProfileNotFoundError(profile);
    }
    const password = await promptPassword('Master password: ');
    if (password.length === 0) {
        throw new UsageError('Master password cannot be empty.');
    }
    const secrets = vault.readProfile(profile, password);
    return spawnWithEnv(command, args, secrets);
}
