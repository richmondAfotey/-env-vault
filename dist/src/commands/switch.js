/**
 * `env-vault switch <profile>` — point `run`/`export` at another profile.
 *
 * Does NOT touch the password: switching only rewrites `.envvault/config.json`.
 */
import { Vault } from '../storage/vault.js';
export function switchCommand(profile, root = process.cwd()) {
    const vault = new Vault(root);
    // Throws ProfileNotFoundError if the profile has no vault on disk.
    vault.setActiveProfile(profile);
    console.log(`* Switched active profile to '${profile}'`);
}
