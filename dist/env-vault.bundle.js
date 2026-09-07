#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var fs3 = __toESM(require("node:fs"), 1);
var import_node_util = require("node:util");

// src/commands/export.ts
var path2 = __toESM(require("node:path"), 1);

// src/utils/errors.ts
var VaultError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "VaultError";
  }
};
var UsageError = class extends VaultError {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
};
var PasswordError = class extends VaultError {
  constructor() {
    super("Invalid master password or corrupted vault.");
    this.name = "PasswordError";
  }
};
var ProfileNotFoundError = class extends VaultError {
  constructor(profile) {
    super(
      `Profile '${profile}' does not exist. Create it with: env-vault set KEY=VALUE --profile ${profile}`
    );
    this.name = "ProfileNotFoundError";
  }
};
var CommandNotFoundError = class extends VaultError {
  constructor(command) {
    super(`Command not found: ${command}`);
    this.name = "CommandNotFoundError";
  }
};
var ANSI_RED = "\x1B[31m";
var ANSI_BOLD = "\x1B[1m";
var ANSI_RESET = "\x1B[0m";
function paint(text, code, useColor) {
  return useColor ? `${code}${text}${ANSI_RESET}` : text;
}
function red(text, useColor = process.stderr.isTTY) {
  return paint(text, ANSI_RED, useColor);
}
function bold(text, useColor = process.stderr.isTTY) {
  return paint(text, ANSI_BOLD, useColor);
}

// src/utils/prompt.ts
var readline = __toESM(require("node:readline"), 1);
function isTTY() {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}
var shared = null;
var answers = [];
var waiters = [];
function iface() {
  if (!shared) {
    shared = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTTY()
    });
    shared.on("line", (line) => {
      const respond = waiters.shift();
      if (respond) {
        respond(line);
      } else {
        answers.push(line);
      }
    });
    shared.on("SIGINT", () => {
      process.stdout.write("\n");
      process.exit(130);
    });
    shared.on("close", () => {
      while (waiters.length > 0) {
        const respond = waiters.shift();
        if (respond) {
          respond("");
        }
      }
    });
  }
  return shared;
}
function readLine(label, masked) {
  const rl = iface();
  rl._writeToOutput = masked ? (s) => rl.output.write("*".repeat(s.length)) : (s) => rl.output.write(s);
  process.stdout.write(label);
  return new Promise((resolve2) => {
    const ready = answers.shift();
    if (ready !== void 0) {
      resolve2(ready);
    } else {
      waiters.push(resolve2);
    }
  });
}
function promptPassword(label) {
  return readLine(label, isTTY());
}
function promptConfirm(question) {
  return readLine(question, false).then((answer) => {
    const a = answer.trim().toLowerCase();
    return a === "y" || a === "yes";
  });
}

// src/storage/vault.ts
var fs = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);

// src/crypto/cipher.ts
var crypto = __toESM(require("node:crypto"), 1);
var MAGIC = "ENVVAULT";
var VERSION = 1;
var KDF_PBKDF2_SHA256 = 1;
var DEFAULT_ITERATIONS = 6e5;
var SALT_BYTES = 16;
var IV_BYTES = 12;
var TAG_BYTES = 16;
var KEY_BYTES = 32;
var HEADER_BYTES = Buffer.byteLength(MAGIC) + 1 + 1 + 4 + SALT_BYTES + IV_BYTES;
var MAX_ITERATIONS = 1e7;
function deriveKey(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_BYTES, "sha256");
}
function encodeHeader(header) {
  const buf = Buffer.alloc(HEADER_BYTES);
  buf.write(MAGIC, 0, "utf8");
  buf.writeUInt8(header.version, 8);
  buf.writeUInt8(header.kdf, 9);
  buf.writeUInt32BE(header.iterations, 10);
  header.salt.copy(buf, 14);
  header.iv.copy(buf, 14 + SALT_BYTES);
  return buf;
}
function decodeHeader(data) {
  if (data.length < HEADER_BYTES + TAG_BYTES) {
    throw new PasswordError();
  }
  const magic = data.subarray(0, Buffer.byteLength(MAGIC)).toString("utf8");
  if (magic !== MAGIC) {
    throw new PasswordError();
  }
  const iterations = data.readUInt32BE(10);
  if (iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new PasswordError();
  }
  return {
    version: data.readUInt8(8),
    kdf: data.readUInt8(9),
    iterations,
    salt: data.subarray(14, 14 + SALT_BYTES),
    iv: data.subarray(14 + SALT_BYTES, 14 + SALT_BYTES + IV_BYTES)
  };
}
function isSecretMap(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
}
function encryptVault(profile, password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt, iterations);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(profile), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const header = encodeHeader({
    version: VERSION,
    kdf: KDF_PBKDF2_SHA256,
    iterations,
    salt,
    iv
  });
  return Buffer.concat([header, ciphertext, authTag]);
}
function decryptVault(data, password) {
  const header = decodeHeader(data);
  if (header.version !== VERSION || header.kdf !== KDF_PBKDF2_SHA256) {
    throw new PasswordError();
  }
  let key;
  try {
    key = deriveKey(password, header.salt, header.iterations);
  } catch {
    throw new PasswordError();
  }
  const authTag = data.subarray(data.length - TAG_BYTES);
  const ciphertext = data.subarray(HEADER_BYTES, data.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, header.iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    if (!isSecretMap(parsed)) {
      throw new Error("vault payload is not a flat string map");
    }
    return parsed;
  } catch {
    throw new PasswordError();
  }
}

// src/storage/vault.ts
var DEFAULT_PROFILE = "development";
var VAULT_DIR_NAME = ".envvault";
var CONFIG_FILE_NAME = "config.json";
var PROFILE_NAME_RE = /^[A-Za-z0-9_-]+$/;
function atomicWrite(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, data, { mode: 384 });
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}
var Vault = class {
  constructor(root = process.cwd()) {
    this.root = root;
  }
  root;
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
    const existing = this.hasProfile(profile) ? this.readProfile(profile, password) : {};
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
      const raw = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      if (typeof raw === "object" && raw !== null && typeof raw.activeProfile === "string") {
        const name = raw.activeProfile;
        if (name.trim()) {
          return name;
        }
      }
    } catch {
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
    atomicWrite(this.configPath, JSON.stringify(config, null, 2) + "\n");
  }
  assertProfileName(profile) {
    if (!PROFILE_NAME_RE.test(profile)) {
      throw new UsageError(
        `Invalid profile name '${profile}'. Use only letters, numbers, "_" or "-".`
      );
    }
  }
};

// src/commands/export.ts
async function exportCommand(opts, root = process.cwd()) {
  const outFile = opts.out;
  if (!outFile) {
    throw new UsageError(
      "Usage: env-vault export [--profile name] --out <file> [--force]"
    );
  }
  const vault = new Vault(root);
  const profile = opts.profile ?? vault.readActiveProfile();
  if (!vault.hasProfile(profile)) {
    throw new ProfileNotFoundError(profile);
  }
  if (!opts.force) {
    console.warn(
      red(
        bold(
          "WARNING: this writes PLAIN-TEXT secrets to disk, visible to anyone"
        )
      )
    );
    console.warn(red(bold("with read access to the output file.")));
    console.warn(red("Only use this for legacy local debugging."));
    const ok = await promptConfirm("Type 'yes' to continue: ");
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }
  const password = await promptPassword("Master password: ");
  if (password.length === 0) {
    throw new UsageError("Master password cannot be empty.");
  }
  const secrets = vault.readProfile(profile, password);
  const entries = Object.keys(secrets).sort().map((k) => `${k}=${secrets[k]}`);
  atomicWrite(path2.resolve(root, outFile), entries.join("\n") + "\n");
  console.log(
    `* Exported ${entries.length} variable(s) from profile '${profile}' to ${outFile}`
  );
  console.warn(red("Reminder: that file contains PLAIN-TEXT secrets."));
}

// src/commands/init.ts
var fs2 = __toESM(require("node:fs"), 1);
var path3 = __toESM(require("node:path"), 1);
var GITIGNORE_BLOCK = `# env-vault
.env*
!.envvault/
!.envvault/*.enc
!.env.example
`;
var ENV_EXAMPLE = `# env-vault example file -- NEVER store real secrets here.
# Real secrets live in encrypted vaults under .envvault/ and are created with:
#
#   env-vault set KEY=value --profile development
#
# List the variables your app expects; keep the values safe (or empty).

DATABASE_URL=postgres://localhost:5432/myapp
API_KEY=changeme
LOG_LEVEL=info
`;
function init(root = process.cwd()) {
  const vault = new Vault(root);
  vault.ensureVaultDir();
  console.log(`* Initialized ${VAULT_DIR_NAME}/`);
  const gitignorePath = path3.join(root, ".gitignore");
  if (fs2.existsSync(gitignorePath)) {
    const existing = fs2.readFileSync(gitignorePath, "utf8");
    if (existing.includes(GITIGNORE_BLOCK)) {
      console.log("* .gitignore already has env-vault rules (no change)");
    } else {
      const separator = existing.endsWith("\n") ? "" : "\n";
      fs2.appendFileSync(gitignorePath, `${separator}${GITIGNORE_BLOCK}
`);
      console.log("* Appended env-vault rules to .gitignore");
    }
  } else {
    fs2.writeFileSync(gitignorePath, GITIGNORE_BLOCK);
    console.log("* Created .gitignore with env-vault rules");
  }
  const examplePath = path3.join(root, ".env.example");
  if (fs2.existsSync(examplePath)) {
    console.log("* .env.example exists (no change)");
  } else {
    fs2.writeFileSync(examplePath, ENV_EXAMPLE);
    console.log("* Created .env.example");
  }
  console.log("");
  console.log("env-vault is ready. Add a secret with:");
  console.log("  env-vault set KEY=VALUE --profile development");
}

// src/utils/process.ts
var import_node_child_process = require("node:child_process");
function spawnWithEnv(command, args, secrets) {
  return new Promise((resolve2, reject) => {
    const mergedEnv = { ...process.env };
    for (const [key, value] of Object.entries(secrets)) {
      mergedEnv[key] = value;
    }
    for (const key of Object.keys(mergedEnv)) {
      if (mergedEnv[key] === void 0) {
        delete mergedEnv[key];
      }
    }
    let child;
    try {
      child = (0, import_node_child_process.spawn)(command, args, {
        stdio: "inherit",
        env: mergedEnv
      });
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new CommandNotFoundError(command));
      } else {
        reject(err);
      }
    });
    child.on("exit", (code, signal) => {
      if (code !== null) {
        resolve2(code);
      } else {
        reject(
          new Error(
            `Command was terminated${signal ? ` by signal ${signal}` : ""}.`
          )
        );
      }
    });
  });
}

// src/commands/run.ts
async function runCommand(runArgs, root = process.cwd()) {
  if (runArgs.length === 0) {
    throw new UsageError("Usage: env-vault run -- <command> [args...]");
  }
  const command = runArgs[0];
  if (!command) {
    throw new UsageError("Usage: env-vault run -- <command> [args...]");
  }
  const args = runArgs.slice(1);
  const vault = new Vault(root);
  const profile = vault.readActiveProfile();
  if (!vault.hasProfile(profile)) {
    throw new ProfileNotFoundError(profile);
  }
  const password = await promptPassword("Master password: ");
  if (password.length === 0) {
    throw new UsageError("Master password cannot be empty.");
  }
  const secrets = vault.readProfile(profile, password);
  return spawnWithEnv(command, args, secrets);
}

// src/commands/set.ts
var KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function parseKeyValue(pair) {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    throw new UsageError(
      `Expected KEY=VALUE, got '${pair}'. Usage: env-vault set KEY=VALUE [--profile name]`
    );
  }
  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  if (!KEY_RE.test(key)) {
    throw new UsageError(`Invalid environment variable name '${key}'`);
  }
  return { key, value };
}
async function setCommand(pair, profile = DEFAULT_PROFILE, root = process.cwd()) {
  const { key, value } = parseKeyValue(pair);
  const password = await promptPassword("Master password: ");
  if (password.length === 0) {
    throw new UsageError("Master password cannot be empty.");
  }
  const vault = new Vault(root);
  vault.updateProfile(profile, { [key]: value }, password);
  console.log(`* Saved ${key} in profile '${profile}'`);
}

// src/commands/switch.ts
function switchCommand(profile, root = process.cwd()) {
  const vault = new Vault(root);
  vault.setActiveProfile(profile);
  console.log(`* Switched active profile to '${profile}'`);
}

// src/index.ts
var import_meta = {};
var OPTIONS = {
  profile: { type: "string" },
  out: { type: "string" },
  force: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" }
};
function usage() {
  return `env-vault \u2014 encrypted .env profile manager

Usage: env-vault <command> [options]

Commands:
  init                            Create .envvault/, safe .gitignore rules, and .env.example
  set KEY=VALUE [--profile name]  Encrypt a value into a profile (default: development)
  switch <profile>                Set the active profile used by run/export
  run -- <command> [args...]      Run a command with the profile injected in-memory
  export [--profile name] --out <file> [--force]
                                  Write a plain-text copy of a profile (legacy debugging)

Options:
  --profile <name>  Which profile to operate on
  --out <file>      Output file path (export)
  --force           Skip the export plain-text warning (data to disk!)
  -h, --help        Show this help
  -v, --version     Print version

Examples:
  env-vault init
  env-vault set DATABASE_URL=postgres://prod:5432/db --profile production
  env-vault switch production
  env-vault run -- npm start
  env-vault export --profile development --out .env.local --force`;
}
function splitAtDoubleDash(argv) {
  const idx = argv.indexOf("--");
  if (idx === -1) {
    return { before: argv, after: [] };
  }
  return { before: argv.slice(0, idx), after: argv.slice(idx + 1) };
}
function readVersion() {
  if ("1.0.0") {
    return `env-vault ${"1.0.0"}`;
  }
  try {
    const pkg = JSON.parse(
      fs3.readFileSync(new URL("../../package.json", import_meta.url), "utf8")
    );
    return `env-vault ${pkg.version ?? "unknown"}`;
  } catch {
    return "env-vault unknown";
  }
}
async function main(argv) {
  if (argv[0] === "run") {
    return runCommand(splitAtDoubleDash(argv).after);
  }
  const { values, positionals } = (0, import_node_util.parseArgs)({
    args: argv,
    options: OPTIONS,
    allowPositionals: true
  });
  if (values.help) {
    console.log(usage());
    return 0;
  }
  if (values.version) {
    console.log(readVersion());
    return 0;
  }
  const command = positionals[0];
  switch (command) {
    case void 0:
      if (argv.length === 0) {
        console.log(usage());
        return 0;
      }
      throw new UsageError("No command given. Run `env-vault --help` for usage.");
    case "init":
      init();
      return 0;
    case "set": {
      const pair = positionals[1];
      if (!pair) {
        throw new UsageError("Usage: env-vault set KEY=VALUE [--profile name]");
      }
      await setCommand(pair, values.profile ?? DEFAULT_PROFILE);
      return 0;
    }
    case "switch": {
      const profile = positionals[1];
      if (!profile) {
        throw new UsageError("Usage: env-vault switch <profile>");
      }
      switchCommand(profile);
      return 0;
    }
    case "export":
      await exportCommand({
        profile: values.profile,
        out: values.out,
        force: values.force
      });
      return 0;
    default:
      throw new UsageError(
        `Unknown command '${command}'. Run \`env-vault --help\` for usage.`
      );
  }
}
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((err) => {
  if (err instanceof VaultError) {
    console.error(`env-vault: ${err.message}`);
  } else if (err instanceof Error && /Unknown option/i.test(err.message)) {
    console.error(`env-vault: ${err.message}`);
    console.error("Run `env-vault --help` for usage.");
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
