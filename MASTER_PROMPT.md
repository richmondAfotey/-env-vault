# Master Agent Prompt — `env-vault`

> The final, tightened execution prompt for reproducing this repository with a
> terminal-based coding agent. It reflects the implementation as actually
> built, including the security review amendments (OWASP-aligned KDF, `--force`
> export gate, in-memory-only injection, zero-dependency parsing). Paste the
> block below into a fresh agent session.

````markdown
### MASTER AGENT PROMPT: BUILD `env-vault` CLI TOOL

**SYSTEM ROLE:**
You are an expert CLI Engineer building a lightweight, secure, cross-platform
terminal utility named `env-vault` using Node.js (>=18) and TypeScript.
Construct, test, and package it in a single execution session. Keep the
published tool ZERO runtime dependencies (Node builtins only; build/dev tools
may be devDependencies).

---

### 1. CORE ARCHITECTURE & SPECIFICATIONS

#### A. Security Model
- **Encryption:** AES-256-GCM (12-byte random IV per write).
- **Key derivation:** PBKDF2-HMAC-SHA256, **600,000 iterations**
  (OWASP-aligned, not the naive 100k), 16-byte random salt, 32-byte key.
- **On-disk format:** `.envvault/<profile>.enc` binary blob:
  `MAGIC(8) | version(1) | kdf(1) | iterations(4) | salt(16) | iv(12) |
  ciphertext | authTag(16)`.
- **Uniform failures:** wrong password, tampered data, bad magic, and truncated
  files must ALL surface as the single error
  `Invalid master password or corrupted vault.` — never distinguish why, or you
  create a decryption oracle.
- **Disk persistence rule:** raw `.env` secrets MUST NEVER be written to disk by
  default. `run` decrypts to memory and injects via the child process
  environment (`stdio: 'inherit'`), then propagates the child exit code.
- **Git safety:** `init` writes `.gitignore` rules:
  `.env*` then `!.envvault/`, `!.envvault/*.enc`, `!.env.example` — encrypted
  vaults are committed/shared; plain `.env*` is never.
- **Path safety:** profile names MUST be validated (`/^[A-Za-z0-9_-]+$/`) on
  BOTH read and write so `--profile ../x` cannot escape `.envvault/`.
- **Atomicity:** every write goes through temp-file + rename (`0o600`).

#### B. CLI Commands & Workflow
1. `env-vault init` — mkdir `.envvault/`, append/refresh the gitignore block,
   create `.env.example` if missing.
2. `env-vault set <KEY=VAL> --profile <name>` — masked master-password prompt
   (`node:readline`, stars, Ctrl+C => 130); encrypt and save/update the pair
   (default profile `development`). First write to a profile creates it; later
   writes must match the master password.
3. `env-vault switch <profile>` — set `.envvault/config.json` pointer
   `{ "activeProfile": ... }`; error if the profile has no vault.
4. `env-vault run -- <command> [args...]` — everything AFTER `--` passes to the
   child verbatim (parse BEFORE consuming options). Prompt, decrypt active
   profile, spawn with merged env, exit with the child's code.
5. `env-vault export --profile <name> --out <file>` — the ONLY plain-text
   disk-write; requires a typed confirmation (parse `y`/`yes`) PLUS an opt-in
   `--force` to skip it; always prints a red warning. Writes sorted keys.

#### C. Zero-Dependency Parsing & Prompts
- Use `node:util` `parseArgs` (no commander), keys `[A-Za-z_][A-Za-z0-9_]*`.
- Password prompt: a SINGLE shared `node:readline` interface across the whole
  process with a queue of answers and waiters — do NOT create a fresh interface
  per prompt (it swallows the second piped line). On EOF, resolve pending
  prompts with `''` instead of hanging.

---

### 2. PROJECT REPOSITORY STRUCTURE

    env-vault/
    ├── .github/workflows/release.yml   # multi-platform SEA binaries on tags
    ├── scripts/
    │   ├── bundle.mjs                 # esbuild → single CJS file (+version define)
    │   └── sea.mjs                    # Node SEA single-file executable + postject
    ├── src/
    │   ├── commands/{init,set,switch,run,export}.ts
    │   ├── crypto/cipher.ts           # AES-256-GCM + PBKDF2 engine
    │   ├── storage/vault.ts           # profile CRUD, config pointer, atomic writes
    │   ├── utils/{process,prompt,errors}.ts
    │   └── index.ts                   # CLI entry (parseArgs router)
    ├── tests/{cipher,vault,process}.test.ts   # node:test
    ├── .gitignore  /  LICENSE (MIT)  /  sea-config.json
    ├── package.json  /  tsconfig.json  /  README.md  /  .env.example
    └── MASTER_PROMPT.md

---

### 3. EXECUTION STEPS FOR AGENT (sequential)

1. **Scaffold:** `package.json` (`type: module`, `bin: env-vault` -> compiled
   entry, scripts build/test/bundle/sea), `tsconfig.json` (ES2022, NodeNext,
   strict, `noUncheckedIndexedAccess`), `.gitignore`, `LICENSE` (MIT),
   `.env.example`. Install devDeps only: `typescript`, `@types/node`, `esbuild`,
   `postject`.
2. **Core engine:** `src/crypto/cipher.ts` (native `node:crypto`);
   `src/storage/vault.ts` (encrypt/decrypt round-trip, immutable merges,
   atomic writes, traversal guard); `src/utils/process.ts`
   (`child_process.spawn`, `stdio: 'inherit'`, merged env, ENOENT =>
   friendly error); `src/utils/prompt.ts` (shared readline + queue, masked
   input); `src/utils/errors.ts` (VaultError / UsageError / PasswordError /
   ProfileNotFoundError / CommandNotFoundError).
3. **CLI commands:** wire the five commands + `src/index.ts` with a `run --`
   fast path before `parseArgs`, uniform error mapping in the entry catch,
   and `--version` that prefers a build-time-injected constant.
4. **Tests (TDD, RED→GREEN):** node:test over the compiled output
   (`npm test` = `tsc` then `node --test "dist/tests/**/*.test.js"`). Coverage
   must include: round-trip, wrong password, tampered authTag, non-vault input,
   iteration-count DoS guard, no-plaintext-in-blob, empty profile, spawn env
   injection + exit code, missing binary, missing profile, wrong password,
   path traversal on read AND write, atomicity. GET ALL GREEN BEFORE DOCS.
5. **End-to-end smoke (mandatory gate):** creates a throwaway dir,
   init → set → switch → run -- <node -e reading process.env> → assert the
   injected values; assert a wrong password exits 1; export with and without
   `--force`; then assert NO plaintext secret appears anywhere under `.envvault/`.
   NOTE: when scripting the smoke through PowerShell-native pipes, PowerShell
   prepends a UTF-8 BOM to the first piped line — feed stdin from
   `cmd /c "type fixture.txt | ..."` files instead, or the password silently
   gains a BOM.
6. **Documentation & CI:** full README (features, quickstart, security
   architecture + threat model, ASCII workflow diagram, command reference,
   git-safety section). `.github/workflows/release.yml`: on `v*` tags, matrix
   {ubuntu, macos, windows}, `npm ci` → `npm test` → `npm run bundle` →
   `node scripts/sea.mjs <asset>` → smoke `./<asset> --version` → attach assets
   to the GitHub Release.
7. **Finish:** confirm the whole flow: `npm test` green, binary smoke green,
   README/CI present, initial git commit on `main` (conventional commit), NO
   plain-text secret anywhere in `.envvault/`.

INSTRUCTION: Begin execution now. Build files, run verification tests, and
confirm completion once all modules are operational.
````