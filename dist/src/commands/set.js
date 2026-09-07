/**
 * `env-vault set KEY=VALUE [--profile <name>]` — encrypt one variable.
 *
 * Always prompts for the master password:
 *   - first write to a profile  -> the password that encrypts it
 *   - later writes              -> the password must match, or decryption fails
 */
import { DEFAULT_PROFILE, Vault } from '../storage/vault.js';
import { UsageError } from '../utils/errors.js';
import { promptPassword } from '../utils/prompt.js';
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function parseKeyValue(pair) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
        throw new UsageError(`Expected KEY=VALUE, got '${pair}'. Usage: env-vault set KEY=VALUE [--profile name]`);
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!KEY_RE.test(key)) {
        throw new UsageError(`Invalid environment variable name '${key}'`);
    }
    return { key, value };
}
export async function setCommand(pair, profile = DEFAULT_PROFILE, root = process.cwd()) {
    const { key, value } = parseKeyValue(pair);
    const password = await promptPassword('Master password: ');
    if (password.length === 0) {
        throw new UsageError('Master password cannot be empty.');
    }
    const vault = new Vault(root);
    vault.updateProfile(profile, { [key]: value }, password);
    console.log(`* Saved ${key} in profile '${profile}'`);
}
