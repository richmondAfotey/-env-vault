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
import { decryptVault, encryptVault, type SecretMap } from '../crypto/cipher.js';
import { ProfileNotFoundError, UsageError } from '../utils/errors.js';

export const DEFAULT_PROFILE = 'development';

export const VAULT_DIR_NAME = '.envvault';
export const CONFIG_FILE_NAME = 'config.json';

/** Profile names become file names; keep them filesystem-safe. */
const PROFILE_NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface VaultConfig {
  activeProfile: string;
}

/** Atomic write: write a temp file, then rename over the target. */
export function atomicWrite(filePath: string, data: string | Buffer): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, data, { mode: 0o600 });
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

export class Vault {
  constructor(private readonly root: string = process.cwd()) {}

  get vaultDir(): string {
    return path.join(this.root, VAULT_DIR_NAME);
  }

  profilePath(profile: string): string {
    return path.join(this.vaultDir, `${profile}.enc`);
  }

  get configPath(): string {
    return path.join(this.vaultDir, CONFIG_FILE_NAME);
  }

  ensureVaultDir(): void {
    fs.mkdirSync(this.vaultDir, { recursive: true });
  }

  hasProfile(profile: string): boolean {
    return fs.existsSync(this.profilePath(profile));
  }

  /** Decrypt a profile. Throws ProfileNotFoundError / PasswordError. */
  readProfile(profile: string, password: string): SecretMap {
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
  writeProfile(profile: string, data: SecretMap, password: string): void {
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
  updateProfile(
    profile: string,
    updates: SecretMap,
    password: string,
  ): SecretMap {
    const existing = this.hasProfile(profile)
      ? this.readProfile(profile, password)
      : {};
    const merged: SecretMap = { ...existing, ...updates };
    this.writeProfile(profile, merged, password);
    return merged;
  }

  /** Active profile from config.json, or `development` if absent/corrupt. */
  readActiveProfile(): string {
    if (!fs.existsSync(this.configPath)) {
      return DEFAULT_PROFILE;
    }
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      if (
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as VaultConfig).activeProfile === 'string'
      ) {
        const name = (raw as VaultConfig).activeProfile;
        if (name.trim()) {
          return name;
        }
      }
    } catch {
      // Corrupt config: fall back to the default instead of crashing.
    }
    return DEFAULT_PROFILE;
  }

  /** Persist the active-profile pointer. Fails if the profile has no vault. */
  setActiveProfile(profile: string): void {
    this.assertProfileName(profile);
    if (!this.hasProfile(profile)) {
      throw new ProfileNotFoundError(profile);
    }
    this.ensureVaultDir();
    const config: VaultConfig = { activeProfile: profile };
    atomicWrite(this.configPath, JSON.stringify(config, null, 2) + '\n');
  }

  private assertProfileName(profile: string): void {
    if (!PROFILE_NAME_RE.test(profile)) {
      throw new UsageError(
        `Invalid profile name '${profile}'. ` +
          'Use only letters, numbers, "_" or "-".',
      );
    }
  }
}