/**
 * Central, uniform error types for env-vault.
 *
 * Security note: decryption failures (wrong password, corrupted vault, tampered
 * data, bad magic) all collapse into the single `PasswordError` class with one
 * indistinguishable message. This prevents an attacker from using error
 * differences as an oracle to learn anything about the vault's contents.
 */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/** Bad CLI usage: invalid arguments, unknown command, empty password, etc. */
export class UsageError extends VaultError {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Wrong master password, corrupted data, or data that isn't an env-vault. */
export class PasswordError extends VaultError {
  constructor() {
    super('Invalid master password or corrupted vault.');
    this.name = 'PasswordError';
  }
}

/** The referenced profile does not exist on disk. */
export class ProfileNotFoundError extends VaultError {
  constructor(profile: string) {
    super(
      `Profile '${profile}' does not exist. Create it with: ` +
        `env-vault set KEY=VALUE --profile ${profile}`,
    );
    this.name = 'ProfileNotFoundError';
  }
}

/** The command passed to `env-vault run -- <cmd>` could not be found. */
export class CommandNotFoundError extends VaultError {
  constructor(command: string) {
    super(`Command not found: ${command}`);
    this.name = 'CommandNotFoundError';
  }
}

/* ------------------------------------------------------------------ */
/* ANSI color helpers (kept dependency-free; only applied on TTYs).    */
/* ------------------------------------------------------------------ */

const ANSI_RED = '[31m';
const ANSI_YELLOW = '[33m';
const ANSI_BOLD = '[1m';
const ANSI_RESET = '[0m';

function paint(text: string, code: string, useColor: boolean): string {
  return useColor ? `${code}${text}${ANSI_RESET}` : text;
}

export function red(text: string, useColor = process.stderr.isTTY): string {
  return paint(text, ANSI_RED, useColor);
}

export function yellow(text: string, useColor = process.stderr.isTTY): string {
  return paint(text, ANSI_YELLOW, useColor);
}

export function bold(text: string, useColor = process.stderr.isTTY): string {
  return paint(text, ANSI_BOLD, useColor);
}