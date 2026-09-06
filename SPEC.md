# env-vault — Technical Specification

This document is the working spec for the `env-vault` repository: architecture,
security model, CLI contract, and the build order used to implement it. It is
the source of truth for the current behavior and the starting point for future
changes.

---

## 1. Goals

`env-vault` is a lightweight, secure, cross-platform terminal utility for
managing environment-variable profiles:

1. Keep per-environment secrets in **encrypted profiles** instead of scattered,
   plain-text `.env` files.
2. Inject the right profile **in memory** when running a command — plain-text
   secrets are never written to disk by default and never reach Git.
3. Ship as a **zero runtime dependency** Node.js tool (Node builtins only;
   build/dev tooling is dev-only).

## 2. Security Model

### 2.1 Encryption (at rest)

- **Cipher:** AES-256-GCM, 12-byte random IV generated for every write.
- **Key derivation:** PBKDF2-HMAC-SHA256, **600,000 iterations**
  (OWASP-aligned), 16-byte random salt per write, 32-byte derived key.
- The derived key exists only transiently in memory; the master password is
  never stored. A password is verified on every decrypt via the GCM authTag.

### 2.2 On-disk format

Each profile is one file, `.envvault/<profile>.enc`:

```
+----------+---------+-----+------------+---------+---------+--------------+---------+
| "ENVVAULT"|version  | KDF | iterations |  salt   |   IV    |  ciphertext  | authTag |
|   8 bytes| 1 byte  | 1   |  4 bytes   |16 bytes |12 bytes |   (varies)   | 16 bytes|
+----------+---------+-----+------------+---------+---------+--------------+---------+
```

- Header iteration counts are bounded (`1 .. 10,000,000`) to prevent a
  crafted blob from forcing an unbounded PBKDF2 cost.
- Version + KDF fields exist so the format can evolve; unknown values are
  rejected.

### 2.3 Failure contract

Wrong password, tampered ciphertext, bad magic, truncation, and invalid header
fields must **all** surface as the single, identical error:

```
Invalid master password or corrupted vault.
```

Distinguishing between these cases (even in logs) would turn the tool into a
decryption oracle for whoever controls the vault file.

### 2.4 Runtime injection

`run` decrypts the active profile in memory and spawns the child with the
secrets merged over the parent environment (`stdio: 'inherit'`); the child's
exit code propagates to the CLI's exit code. Nothing is written to disk on this
path.

### 2.5 Git safety

`init` writes the following `.gitignore` rules (the repo ships the same):

```gitignore
.env*
!.envvault/
!.envvault/*.enc
!.env.example
```

Plain `.env*` files are never tracked; encrypted vaults are safe to commit and
share. `.envvault/config.json` (the active-profile pointer) contains no
secrets and is local-only.

### 2.6 Path safety

Profile names become file names, so they are restricted to
`/^[A-Za-z0-9_-]+$/` and validated on **both** the read and write paths.
This prevents `--profile ../x` from escaping `.envvault/` to reach a vault
elsewhere on disk.

### 2.7 Write safety

Every write uses temp-file + atomic rename with `0o600` permissions, so a crash
mid-write cannot leave a truncated vault or a readable interim file.

## 3. CLI Contract

| Command | Behavior |
|---|---|
| `env-vault init` | Create `.envvault/`; append/refresh the gitignore block; create `.env.example` if missing. |
| `env-vault set <KEY=VAL> [--profile <name>]` | Prompt for the masked master password; encrypt and save/update the pair (default profile `development`). First write creates the profile; later writes must match its password. |
| `env-vault switch <profile>` | Set the `.envvault/config.json` pointer (`{ "activeProfile": ... }`); error if the profile has no vault. |
| `env-vault run -- <command> [args...]` | Everything after `--` is passed verbatim to the child. Prompt; decrypt the active profile; spawn with the secrets in the child env; exit with the child's code. |
| `env-vault export [--profile <name>] --out <file> [--force]` | The only plain-text disk write (sorted keys). Requires a typed `y`/`yes` confirmation unless `--force`; always prints a plain-text warning. For legacy local debugging. |

Conventions:

- Argument parsing uses `node:util` `parseArgs` (no third-party CLI lib).
- Key names must match `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- Prompts share a **single** `node:readline` interface with a queue of answers
  and waiters. A fresh interface per prompt swallows the second piped line, and
  a missing prompt answer on EOF hangs — both are rejected behaviors. EOF
  resolves pending prompts with `''`.
- `Ctrl+C` at a prompt exits with status 130.
- `--version` prefers a build-time-injected version constant (the SEA binary
  has no `package.json` on disk) and falls back to reading `package.json`.

## 4. Repository Layout

```
env-vault/
├── .github/workflows/release.yml   # multi-platform SEA binaries on tags
├── scripts/
│   ├── bundle.mjs                 # esbuild → single CJS file (+ version define)
│   └── sea.mjs                    # Node SEA single-file executable via postject
├── src/
│   ├── commands/{init,set,switch,run,export}.ts
│   ├── crypto/cipher.ts           # AES-256-GCM + PBKDF2 engine
│   ├── storage/vault.ts           # profile CRUD, config pointer, atomic writes
│   ├── utils/{process,prompt,errors}.ts
│   └── index.ts                   # CLI entry (parseArgs router)
├── tests/{cipher,vault,process}.test.ts       # node:test
├── .gitignore  /  LICENSE (MIT)  /  sea-config.json
├── package.json  /  tsconfig.json  /  README.md  /  .env.example
└── SPEC.md
```

## 5. Build Order (reference for maintenance)

1. **Scaffold:** `package.json` (`type: module`, `bin: env-vault` → compiled
   entry, scripts `build`/`test`/`bundle`/`sea`), `tsconfig.json` (ES2022,
   NodeNext, strict, `noUncheckedIndexedAccess`), `.gitignore`, `LICENSE` (MIT),
   `.env.example`. Dev dependencies only: `typescript`, `@types/node`,
   `esbuild`, `postject`.
2. **Core engine:** `crypto/cipher.ts` (native `node:crypto`), `storage/vault.ts`
   (round-trip, immutable merges, atomic writes, traversal guard),
   `utils/process.ts` (spawn + env merge + ENOENT handling),
   `utils/prompt.ts` (shared readline + masked input), `utils/errors.ts`
   (typed error hierarchy).
3. **CLI:** the five commands plus `index.ts`, with the `run --` fast path
   parsed before options, uniform error mapping at the entry point, and the
   `--version` fallback chain.
4. **Tests:** node:test over the compiled output
   (`npm test` = `tsc` then `node --test "dist/tests/**/*.test.js"`). Coverage:
   round-trip; wrong password; tampered authTag; non-vault input;
   iteration-count DoS guard; no plaintext in blob; empty profile; env
   injection + exit code; missing binary; missing profile; path traversal on
   read and write; atomicity.
5. **End-to-end smoke (release gate):** in a throwaway directory, run
   init → set → switch → run and assert the injected values; assert a wrong
   password exits 1; export with and without `--force`; then assert **no**
   plain-text secret appears anywhere under `.envvault/`.
   _Harness note:_ on Windows, PowerShell-native pipelines prepend a UTF-8 BOM
   to the first line fed to a child process, silently altering a piped master
   password. Feed stdin from byte-exact fixture files
   (`cmd /c "type fixture.txt | ..."`) in automated tests.
6. **Docs & CI:** README (features, quickstart, security architecture + threat
   model, workflow diagram, command reference). `release.yml` runs on `v*`
   tags: `npm ci` → `npm test` → `npm run bundle` →
   `node scripts/sea.mjs <asset>` → smoke `./<asset> --version` → attach assets
   to the GitHub Release.
7. **Release:** confirm `npm test` is green, the binary smoke passes, and no
   plain-text secret exists under `.envvault/`; commit on `main`.

## 6. Known Limits

- Environment variables of a running child are readable by other local
  processes with the same OS user. Inherent to env injection; keep runtime
  windows short and the machine trusted.
- The master password's strength is the encryption strength — there is no
  recovery path if it is lost, and changing it requires re-`set` of each
  profile.