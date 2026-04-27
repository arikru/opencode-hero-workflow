#!/usr/bin/env bun
// hero-init: scaffolds baseline opencode-hero-workflow files into a target project.
// Scope: issues #1, #2, #3. First-run scaffolding plus opencode.json patch plus
// model-role prompts plus idempotent re-runs with content-hash conflict detection.
// Out of scope here:
//   - #4: full Zod-validated .hero/config.jsonc schema
// Extension point: writeManagedFile is the hash-aware writer that consults the
// manifest. New managed files should route through it.

import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { createHash } from "node:crypto";

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "templates");
const MANIFEST_REL = ".hero/.manifest.json";

// Pinned git tag — the literal pin is the deliverable. No floating branch refs.
const PLUGIN_REF = "github:arikru/opencode-hero-workflow#v0.1.2";

const MODEL_ROLES = /** @type {const} */ ([
  { key: "implementer", label: "Implementer", example: "github-copilot/claude-sonnet-4.5" },
  { key: "reviewer", label: "Reviewer", example: "github-copilot/claude-opus-4-7" },
  { key: "planner", label: "Planner", example: "github-copilot/claude-sonnet-4.5" },
]);

async function readPackageVersion() {
  const pkgPath = join(PACKAGE_ROOT, "package.json");
  const raw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  if (typeof pkg.version !== "string") {
    throw new Error("package.json is missing a version field");
  }
  return pkg.version;
}

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function toBuffer(contents) {
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
}

function majorOf(version) {
  const m = /^(\d+)\./.exec(version);
  return m ? Number(m[1]) : NaN;
}

async function readManifest(targetDir) {
  const path = join(targetDir, MANIFEST_REL);
  if (!existsSync(path)) {
    return { version: null, files: /** @type {Record<string, string>} */ ({}) };
  }
  const raw = await readFile(path, "utf8");
  try {
    const parsed = JSON.parse(raw);
    const version = typeof parsed.version === "string" ? parsed.version : null;
    const files =
      parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files)
        ? parsed.files
        : {};
    return { version, files };
  } catch (err) {
    throw new Error(
      `${MANIFEST_REL} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function writeManifest(targetDir, manifest) {
  const path = join(targetDir, MANIFEST_REL);
  await mkdir(dirname(path), { recursive: true });
  const sortedFiles = /** @type {Record<string, string>} */ ({});
  for (const k of Object.keys(manifest.files).sort()) {
    sortedFiles[k] = manifest.files[k];
  }
  const payload = { version: manifest.version, files: sortedFiles };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

// Decides what to do with a single managed file given its would-be content, on-disk
// state, and the prior manifest entry. Manifest tracks the hash of what hero-init last
// wrote, not the template hash, so user-customised files are detected even when the
// template content has not changed.
async function planManagedFile(targetDir, relPath, contents, manifest, mode) {
  const buf = toBuffer(contents);
  const wouldHash = sha256(buf);
  const dest = join(targetDir, relPath);
  const recordedHash = manifest.files[relPath];

  if (!existsSync(dest)) {
    return { action: "write", relPath, buf, wouldHash };
  }

  const diskHash = sha256(await readFile(dest));
  if (diskHash === wouldHash) {
    return { action: "skip", relPath, wouldHash };
  }

  const isTrackedAndModified = recordedHash !== undefined && diskHash !== recordedHash;

  if (isTrackedAndModified) {
    if (mode === "default") {
      return { action: "conflict", relPath };
    }
    return { action: "write", relPath, buf, wouldHash };
  }

  if (recordedHash === undefined) {
    return { action: "skip-foreign", relPath };
  }

  return { action: "write", relPath, buf, wouldHash };
}

async function writeManagedFile(targetDir, relPath, buf) {
  const dest = join(targetDir, relPath);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
}

async function patchOpencodeJson(targetDir) {
  const path = join(targetDir, "opencode.json");
  /** @type {Record<string, unknown>} */
  let config = {};
  let existed = false;
  if (existsSync(path)) {
    existed = true;
    const raw = await readFile(path, "utf8");
    try {
      config = raw.trim().length === 0 ? {} : JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `opencode.json exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("opencode.json must contain a JSON object at the root");
    }
  }

  const before = existed ? JSON.stringify(config) : null;
  config.default_agent = "plan";

  /** @type {string[]} */
  let plugins;
  const existingPlugins = config.plugin;
  if (Array.isArray(existingPlugins)) {
    plugins = existingPlugins.filter((p) => typeof p === "string");
  } else if (typeof existingPlugins === "string") {
    plugins = [existingPlugins];
  } else {
    plugins = [];
  }
  if (!plugins.includes(PLUGIN_REF)) {
    plugins.push(PLUGIN_REF);
  }
  config.plugin = plugins;

  const after = JSON.stringify(config);
  if (existed && before === after) {
    return;
  }
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(existed ? "patched opencode.json" : "wrote opencode.json");
}

function parseFlags(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  const booleanFlags = new Set(["force", "migrate", "sandcastle-enabled"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        if (booleanFlags.has(name)) {
          flags[name] = true;
        } else {
          flags[name] = argv[++i] ?? "";
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

// Flag-based input is the non-interactive path; CI and tests rely on it. TTY callers without
// flags are prompted (Enter accepts the example as default). Non-TTY callers without flags
// (e.g. `bunx ... init` where stdin is piped) silently fall back to the example defaults
// and log which defaults were chosen so the choice is auditable.
async function collectModels(flags) {
  /** @type {Record<string, string>} */
  const models = {};
  const isTTY = Boolean(process.stdin.isTTY);
  /** @type {import("node:readline/promises").Interface | null} */
  let rl = null;

  for (const role of MODEL_ROLES) {
    const flagged = flags[role.key];
    if (typeof flagged === "string") {
      if (flagged.trim().length === 0) {
        throw new Error(`--${role.key} must not be empty`);
      }
      models[role.key] = flagged.trim();
      continue;
    }
    if (!isTTY) {
      console.log(`${role.label} model: using default ${role.example} (no --${role.key} flag, stdin not a TTY)`);
      models[role.key] = role.example;
      continue;
    }
    if (!rl) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
    }
    const answer = (await rl.question(`${role.label} model [${role.example}]: `)).trim();
    models[role.key] = answer.length > 0 ? answer : role.example;
  }

  if (rl) rl.close();
  return models;
}

// Strips // line comments and /* */ block comments from JSONC source. Naive but sufficient
// for the small config templates we ship; #4 will swap in proper JSONC parsing.
function stripJsonComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"])\/\/[^\n]*/g, "$1");
}

// Computes the would-be content for .hero/config.jsonc. Existing user keys are preserved,
// version + models are always overwritten from the current run, and in migrate mode any
// new template keys absent from the user's file are layered in as defaults.
//
// sandcastleEnabled: when explicitly true (via --sandcastle-enabled), force the
// sandcastle.enabled flag in the generated config to true. When false/undefined, do not
// flip an existing user-set flag back to false — Zod schema defaults supply the rest of
// the sandcastle block at runtime, so we only need to write the enabled key.
async function buildHeroConfigContent(targetDir, models, version, mode, sandcastleEnabled) {
  const path = join(targetDir, ".hero", "config.jsonc");
  /** @type {Record<string, unknown>} */
  let config = {};

  const templateRaw = await readFile(join(TEMPLATES_DIR, ".hero", "config.jsonc"), "utf8");
  const templateParsed = JSON.parse(stripJsonComments(templateRaw).trim());

  const fileExisted = existsSync(path);
  if (fileExisted) {
    const raw = await readFile(path, "utf8");
    const stripped = stripJsonComments(raw).trim();
    try {
      config = stripped.length === 0 ? {} : JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        `.hero/config.jsonc exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(".hero/config.jsonc must contain a JSON object at the root");
    }
  }

  if (!fileExisted || mode === "migrate") {
    for (const [k, v] of Object.entries(templateParsed)) {
      if (!(k in config)) config[k] = v;
    }
  }

  config.version = version;
  config.models = models;

  if (sandcastleEnabled) {
    const existingSandcastle =
      config.sandcastle && typeof config.sandcastle === "object" && !Array.isArray(config.sandcastle)
        ? /** @type {Record<string, unknown>} */ (config.sandcastle)
        : {};
    config.sandcastle = { ...existingSandcastle, enabled: true };
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

// Reads sandcastle.enabled from an already-written .hero/config.jsonc. The default is
// false (matches the Zod schema default). bin/init.js stays JSON-only — we don't import
// plugin/config.ts to avoid coupling the CLI to a runtime module.
function readSandcastleEnabled(generatedContent) {
  try {
    const parsed = JSON.parse(stripJsonComments(generatedContent).trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const sc = /** @type {Record<string, unknown>} */ (parsed).sandcastle;
      if (sc && typeof sc === "object" && !Array.isArray(sc)) {
        return /** @type {Record<string, unknown>} */ (sc).enabled === true;
      }
    }
  } catch {
    // Fall through to default.
  }
  return false;
}

// Single-source-of-truth filter: only files under templates/.sandcastle/ when the user has
// opted into Sandcastle. Keeps the conditional out of the walk loop and out of the planner.
function isTemplateAllowed(relPath, sandcastleEnabled) {
  const sandcastlePrefix = `.sandcastle${sep}`;
  if (relPath === ".sandcastle" || relPath.startsWith(sandcastlePrefix)) {
    return sandcastleEnabled;
  }
  return true;
}

async function buildManagedFileSet(targetDir, models, version, mode, sandcastleFlag) {
  /** @type {Array<{ relPath: string, contents: Buffer | string }>} */
  const files = [];

  // Build the canonical .hero/config.jsonc first so we can read sandcastle.enabled out
  // of it; the value drives whether templates/.sandcastle/** is included in this run.
  const configContent = await buildHeroConfigContent(
    targetDir,
    models,
    version,
    mode,
    sandcastleFlag,
  );
  const sandcastleEnabled = readSandcastleEnabled(configContent);

  if (existsSync(TEMPLATES_DIR)) {
    for (const src of walk(TEMPLATES_DIR)) {
      const rel = relative(TEMPLATES_DIR, src);
      if (rel === join(".hero", "config.jsonc")) continue;
      if (!isTemplateAllowed(rel, sandcastleEnabled)) continue;
      const buf = await readFile(src);
      files.push({ relPath: rel, contents: buf });
    }
  }

  files.push({ relPath: join(".hero", ".hero-version"), contents: `${version}\n` });
  files.push({ relPath: join(".hero", "config.jsonc"), contents: configContent });

  return files;
}

// Identifies manifest entries whose files were deleted by the user since the last run.
// They are dropped from the manifest and excluded from this run so we do not recreate
// them; the user can recover any one of them with --force.
function reconcileMissingManagedFiles(targetDir, manifest, expectedRelPaths) {
  const expected = new Set(expectedRelPaths);
  /** @type {Set<string>} */
  const userDeleted = new Set();
  for (const relPath of Object.keys(manifest.files)) {
    if (!expected.has(relPath)) continue;
    const dest = join(targetDir, relPath);
    if (!existsSync(dest)) {
      delete manifest.files[relPath];
      userDeleted.add(relPath);
    }
  }
  return userDeleted;
}

async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const targetArg = positional[0] ?? process.cwd();
  const targetDir = resolve(targetArg);

  const force = flags.force === true;
  const migrate = flags.migrate === true;
  if (force && migrate) {
    throw new Error("--force and --migrate are mutually exclusive");
  }
  const mode = force ? "force" : migrate ? "migrate" : "default";
  const sandcastleFlag = flags["sandcastle-enabled"] === true;

  const models = await collectModels(flags);

  await mkdir(targetDir, { recursive: true });

  const version = await readPackageVersion();
  const manifest = await readManifest(targetDir);

  if (
    manifest.version !== null &&
    majorOf(manifest.version) !== majorOf(version) &&
    mode !== "force"
  ) {
    console.error(
      `Major version mismatch: manifest at v${manifest.version}, package at v${version}. Manual migration required; see CHANGELOG.`,
    );
    process.exit(1);
  }

  const managed = await buildManagedFileSet(targetDir, models, version, mode, sandcastleFlag);
  const userDeleted = reconcileMissingManagedFiles(
    targetDir,
    manifest,
    managed.map((m) => m.relPath),
  );

  /** @type {Array<{ action: string, relPath: string, buf?: Buffer, wouldHash?: string }>} */
  const plans = [];
  for (const item of managed) {
    if (userDeleted.has(item.relPath) && mode !== "force") continue;
    plans.push(await planManagedFile(targetDir, item.relPath, item.contents, manifest, mode));
  }

  const conflicts = plans.filter((p) => p.action === "conflict").map((p) => p.relPath);
  if (conflicts.length > 0) {
    console.error("hero-init refused to overwrite user-modified files:");
    for (const c of conflicts) console.error(`  ${c}`);
    console.error("Run with --force to overwrite or --migrate for compatible upgrades.");
    process.exit(1);
  }

  for (const plan of plans) {
    if (plan.action === "write" && plan.buf && plan.wouldHash) {
      await writeManagedFile(targetDir, plan.relPath, plan.buf);
      manifest.files[plan.relPath] = plan.wouldHash;
      console.log(`wrote ${plan.relPath}`);
    } else if (plan.action === "skip" && plan.wouldHash) {
      manifest.files[plan.relPath] = plan.wouldHash;
    }
  }

  manifest.version = version;
  await writeManifest(targetDir, manifest);

  await patchOpencodeJson(targetDir);

  console.log(`hero-init done (version ${version})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
