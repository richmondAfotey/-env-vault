/**
 * Storage layer: profile lifecycle and the active-profile pointer.
 *
 * Layout on disk (project root):
 *
 *   .envvault/
 *     config.json          { "activeProfile": "development" }  (no secrets)
 *     <profile>.enc        encrypted profile blob               (committed)
 *
 * All object updates are immutable: methods return new maps, they never mutate
 * an input. Writes are atomic (temp file + rename) so a crash mid-write can
 * never leave a truncated vault.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decryptVault, encryptVault } from '../crypto/cipher.js';
import { ProfileNotFoundError, UsageError } from '../utils/errors.js';
export const DEFAULT_PROFILE = 'development';
export const VAULT_DIR_NAME = '.envvault';
export const CONFIG_FILE_NAME = 'config.json';
/** Profile names become file names; keep them filesystem-safe. */
const PROFILE_NAME_RE = /^[A-Za-z0-9_-]+$/;
/** Atomic write: write a temp file, then rename over the target. */
export function atomicWrite(filePath, data) {
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, data, { mode: 0o600 });
    try {
        fs.renameSync(tmpPath, filePath);
    }
    catch (err) {
        fs.rmSync(tmpPath, { force: true });
        throw err;
    }
}
export class Vault {
    root;
    constructor(root = process.cwd()) {
        this.root = root;
    }
    get vaultDir() {
        return path.join(this.root, VAULT_DIR_NAME);
    }
    profilePath(profile) {
        return path.join(this.vaultDir, `${profile}.enc`);
    }
    get configPath() {
        return path.join(this.vaultDir, CONFIG_FILE_NAME);
    }
    ensureVaultDir() {
        fs.mkdirSync(this.vaultDir, { recursive: true });
    }
    hasProfile(profile) {
        return fs.existsSync(this.profilePath(profile));
    }
    /** Decrypt a profile. Throws ProfileNotFoundError / PasswordError. */
    readProfile(profile, password) {
        // Validate on the read path too: an unvalidated name would let
        // `profilePath` escape `.envvault/` and read a sibling vault file.
        this.assertProfileName(profile);
        if (!this.hasProfile(profile)) {
            throw new ProfileNotFoundError(profile);
        }
        const blob = fs.readFileSync(this.profilePath(profile));
        return decryptVault(blob, password);
    }
    /** Encrypt + atomically persist a profile. Creates `.envvault/` as needed. */
    writeProfile(profile, data, password) {
        this.assertProfileName(profile);
        this.ensureVaultDir();
        const blob = encryptVault(data, password);
        atomicWrite(this.profilePath(profile), blob);
    }
    /**
     * Immutably merge `updates` into a profile and persist it. If the profile
     * does not exist yet, it is created from `updates` (password is then the
     * newly-set master password).
     */
    updateProfile(profile, updates, password) {
        const existing = this.hasProfile(profile)
            ? this.readProfile(profile, password)
            : {};
        const merged = { ...existing, ...updates };
        this.writeProfile(profile, merged, password);
        return merged;
    }
    /** Active profile from config.json, or `development` if absent/corrupt. */
    readActiveProfile() {
        if (!fs.existsSync(this.configPath)) {
            return DEFAULT_PROFILE;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            if (typeof raw === 'object' &&
                raw !== null &&
                typeof raw.activeProfile === 'string') {
                const name = raw.activeProfile;
                if (name.trim()) {
                    return name;
                }
            }
        }
        catch {
            // Corrupt config: fall back to the default instead of crashing.
        }
        return DEFAULT_PROFILE;
    }
    /** Persist the active-profile pointer. Fails if the profile has no vault. */
    setActiveProfile(profile) {
        this.assertProfileName(profile);
        if (!this.hasProfile(profile)) {
            throw new ProfileNotFoundError(profile);
        }
        this.ensureVaultDir();
        const config = { activeProfile: profile };
        atomicWrite(this.configPath, JSON.stringify(config, null, 2) + '\n');
    }
    assertProfileName(profile) {
        if (!PROFILE_NAME_RE.test(profile)) {
            throw new UsageError(`Invalid profile name '${profile}'. ` +
                'Use only letters, numbers, "_" or "-".');
        }
    }
}
