# env-vault

**Encrypted `.env` profile manager — zero runtime dependencies.**

`env-vault` ends local environment-variable chaos. Instead of scattering
plain-text `.env` files (and risk committing them), you keep **encrypted
vaults** of key/value profiles and inject them **in memory** when you run a
command. Secrets never touch disk in plain text, and never enter your Git
history.

```
    .env                       dev                                  prod
  ┌──────────┐         ┌──────────────────┐        ┌──────────────────┐
  │ clear    │  ──▶    │ .envvault/       │   ──▶  │ .envvault/       │
  │ secrets  │  set    │ development.enc  │  run   │ production.enc   │
  │ scattered│  AES-   │ production.enc   │  in-   │        ...enc    │
  │ & risky  │  256-   │ config.json      │  memory│                  │
  └──────────┘  GCM    └──────────────────┘        └──────────────────┘
                            │                        │
                            └── commit encrypted      └── encrypted commit
```

## Features

- **AES-256-GCM** at rest, keyed from a master password via **PBKDF2-HMAC-SHA256
  (600,000 iterations)** with a fresh random salt + IV per write.
- **In-memory injection only** — `env-vault run -- <cmd>` decrypts into the
  child process environment; nothing is written to disk.
- **Git-safe by default** — encrypted `.enc` vaults are committed and shared;
  plain `.env*` files are gitignored. Never commit a secret.
- **Zero runtime dependencies** — built entirely on the Node standard library.
- **Cross-platform** — Windows, macOS, and Linux; npm package or single-file
  executables (Node SEA).
- **Atomic writes** — a crash mid-write can never corrupt a vault.

## Requirements

- Node.js **>= 18**
- (Optional, for single-file binaries) none at runtime

## Installation

```bash
# Global install from this repo / package
npm install -g .

# Use without installing
npx . --help

# Or run the compiled CLI directly (faster iteration while developing)
node dist/src/index.js --help
```

> Zero runtime dependencies: the published package ships only compiled
> `dist/src/`. `typescript`, `esbuild`, and `postject` are dev-only.

## Quickstart

```bash
# 1. Initialize: creates .envvault/, safe .gitignore rules, and .env.example
env-vault init

# 2. Encrypt a secret into the `development` profile (default)
env-vault set DATABASE_URL=postgres://localhost:5432/mydb
env-vault set API_KEY=sk_live_1234

# 3. Run a command with those secrets injected in memory
env-vault run -- npm start

# 4. Add a `production` profile and switch between them
env-vault set DATABASE_URL=postgres://prod-01:5432/db --profile production
env-vault set API_KEY=sk_live_abcd --profile production
env-vault switch production
env-vault run -- npm start

# 5. Only for legacy debugging: export a plain-text copy (warns + confirms)
env-vault export --profile development --out .env.local
```

## Command Reference

| Command | Description |
|---|---|
| `env-vault init` | Create `.envvault/`, add safe rules to `.gitignore`, create `.env.example`. |
| `env-vault set KEY=VALUE [--profile <name>]` | Encrypt one variable into a profile (default `development`). Prompts for the master password. |
| `env-vault switch <profile>` | Set the active profile used by `run`. Rewrites only `.envvault/config.json`. |
| `env-vault run -- <command> [args...]` | Decrypt the active profile in memory and spawn `<command>` with the secrets in its environment. |
| `env-vault export [--profile <name>] --out <file> [--force]` | Write a **plain-text** `.env` file (sorted keys) for legacy local debugging. Requires a warning acknowledgment unless `--force`. |
| `env-vault --help` / `--version` | Help and version. |

## Security Architecture

### On-disk format

Each profile is a single file, `.envvault/<profile>.enc`:

```
+----------+---------+-----+------------+---------+---------+--------------+---------+
| "ENVVAULT"|version  | KDF | iterations |  salt   |   IV    |  AES-256-GCM |  authTag|
|   8 bytes| 1 byte  | 1   |  4 bytes   |16 bytes |12 bytes |  ciphertext  | 16 bytes|
+----------+---------+-----+------------+---------+---------+--------------+---------+
```

- **KDF**: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP-aligned), 16-byte
  random salt, 32-byte derived key.
- **Cipher**: AES-256-GCM — the authTag both encrypts and authenticates; a
  wrong password, tampered ciphertext, or truncated file all fail identically
  with `Invalid master password or corrupted vault.` (no oracle).
- **Freshness**: a new random salt and 12-byte IV are generated for every
  write, so identical profiles produce different blobs.
- **Restrictive permissions**: vault and export files are written with
  `0o600` (owner read/write only).

### What env-vault guarantees

| Promise | How it's met |
|---|---|
| No plain-text secrets to disk | Only encrypted blobs are written; `run` injects purely via `process.env` of the spawned child. |
| Master password never stored | Only a PBKDF2-derived key exists transiently in memory; the password is verified via the GCM authTag on every decrypt. |
| Secrets don't reach Git | `.gitignore` ignores `.env*` while allowing `.envvault/*.enc` and `.env.example`; encrypted vaults are safe to commit. |
| No path traversal | Profile names are restricted to `[A-Za-z0-9_-]`, validated on both read and write. |

### Threat model & inherent limits

- While the child process runs, its environment is **readable by other local
  processes with the same OS user** (e.g. `/proc/<pid>/environ` on Linux).
  This is unavoidable for any environment-injection tool; keep runtime windows
  short and your machine trusted.
- The master password strength **is** your encryption strength. Make it long
  and unique; `env-vault` is a vault-in-a-box, not a password manager.
- If you rotate a master password, re-`set` each profile (the format stores no
  password history).

### Git safety (automatic)

`.envvault init` writes the following to `.gitignore` (and the repo ships the
same default):

```gitignore
.env*
!.envvault/
!.envvault/*.enc
!.env.example
```

Committing encrypted `.enc` profiles is the intended collaboration model:
teammates clone the repo, run `set`/`run`, and supply the shared master
password. `config.json` (the active profile pointer) is local-only.

## Development

```bash
npm install          # dev dependencies only
npm test             # type-check, build, run node:test unit tests
npm run build        # tsc -> dist/
npm run bundle       # esbuild -> single-file bundle for SEA binaries
node scripts/sea.mjs env-vault-win-x64.exe   # produce a single-file binary
```

### Continuous delivery

`.github/workflows/release.yml` runs on `v*` tag pushes: matrix build across
Linux / macOS / Windows, runs the full test suite, bundles the CLI, produces
Node SEA single-file executables, smoke-tests each binary (`--version`), and
attaches them to the GitHub Release together with the source.

Tests run against the compiled output via Node's built-in test runner
(`node --test`), so they exercise the real shipped artifacts.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Jones Ampratwum.