#!/usr/bin/env bun
// hero-init: scaffolds baseline opencode-hero-workflow files into a target project.
// Scope: issues #1, #2, #3. First-run scaffolding plus opencode.json patch plus
// model-role prompts plus idempotent re-runs with content-hash conflict detection.
// Out of scope here:
//   - #4: full Zod-validated .hero/config.jsonc schema
// Extension point: writeManagedFile is the hash-aware writer that consults the
// manifest. New managed files should route through it.

import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { createHash } from "node:crypto";

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "templates");
const LOCAL_MANIFEST_REL = ".hero/.manifest.json";
const GLOBAL_MANIFEST_REL = "hero/.manifest.json";

// Pinned git tag — the literal pin is the deliverable. No floating branch refs.
const PLUGIN_REF = "opencode-hero-workflow";
const LEGACY_PLUGIN_REF = "github:arikru/opencode-hero-workflow#v0.1.2";

const MODEL_ROLES = /** @type {const} */ ([
  { key: "implementer", label: "Implementer", example: "github-copilot/claude-sonnet-4.5" },
  { key: "reviewer", label: "Reviewer", example: "github-copilot/claude-opus-4-7" },
  { key: "planner", label: "Planner", example: "github-copilot/claude-sonnet-4.5" },
]);

const GLOBAL_HERO_COMMANDS = /** @type {const} */ ({
  "hero:grill-me": "Load the `hero-grill` skill and start an alignment session on the user-provided topic.",
  "hero:tdd-loop": "Load the `hero-tdd-loop` skill and run a red-green-refactor loop for the selected GitHub issue.",
  "hero:kanban": "Load the `hero-kanban` skill and break the current plan or PRD into vertical-slice GitHub issues.",
  "hero:improve-architecture": "Load the `hero-improve-architecture` skill and scan the codebase for deepening opportunities.",
  "hero:reviewer-standards": "Load the `hero-reviewer-standards` skill and audit the diff with push-style review standards.",
  "hero:dogfood": "Load the `hero-dogfood` skill and run a happy-path to adversarial dogfooding session.",
  "hero:to-prd": "Load the `hero-to-prd` skill and turn the current context into a PRD GitHub issue.",
});

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

async function readManifest(targetDir, manifestRelPath) {
  const path = join(targetDir, manifestRelPath);
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
      `${manifestRelPath} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function writeManifest(targetDir, manifestRelPath, manifest) {
  const path = join(targetDir, manifestRelPath);
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

async function patchOpencodeJson(targetDir, installMode, action = "install") {
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

  if (action === "uninstall" && !existed) {
    return;
  }

  const before = existed ? JSON.stringify(config) : null;
  if (action === "install" && installMode === "local") {
    config.default_agent = "plan";
  }

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
  if (action === "install") {
    if (!plugins.includes(PLUGIN_REF)) {
      plugins.push(PLUGIN_REF);
    }
  } else {
    plugins = plugins.filter((p) => p !== PLUGIN_REF && p !== LEGACY_PLUGIN_REF);
  }
  config.plugin = plugins;

  if (action === "install" && installMode === "global") {
    const existingCommand = config.command;
    /** @type {Record<string, unknown>} */
    const commands =
      existingCommand && typeof existingCommand === "object" && !Array.isArray(existingCommand)
        ? { ...existingCommand }
        : {};
    for (const [key, value] of Object.entries(GLOBAL_HERO_COMMANDS)) {
      if (!(key in commands)) {
        commands[key] = value;
      }
    }
    config.command = commands;
  } else if (action === "uninstall") {
    const existingCommand = config.command;
    if (existingCommand && typeof existingCommand === "object" && !Array.isArray(existingCommand)) {
      const commands = /** @type {Record<string, unknown>} */ ({ ...existingCommand });
      for (const key of Object.keys(commands)) {
        if (key.startsWith("hero:")) {
          delete commands[key];
        }
      }
      config.command = commands;
    }
  }

  const after = JSON.stringify(config);
  if (existed && before === after) {
    return;
  }
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(existed ? "patched opencode.json" : "wrote opencode.json");
}

async function pruneEmptyParents(targetDir, removedPath) {
  let current = dirname(removedPath);
  while (current !== targetDir) {
    const rel = relative(targetDir, current);
    if (rel === "" || rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
      break;
    }
    if (!existsSync(current)) {
      current = dirname(current);
      continue;
    }
    if (readdirSync(current).length > 0) {
      break;
    }
    await rmdir(current);
    current = dirname(current);
  }
}

async function uninstallGlobal(targetDir) {
  const manifestPath = join(targetDir, GLOBAL_MANIFEST_REL);
  if (!existsSync(manifestPath)) {
    throw new Error(`Cannot uninstall: missing manifest at ${manifestPath}`);
  }

  const manifest = await readManifest(targetDir, GLOBAL_MANIFEST_REL);
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const skippedModified = [];

  for (const relPath of Object.keys(manifest.files).sort()) {
    const dest = join(targetDir, relPath);
    if (!existsSync(dest)) continue;

    const diskHash = sha256(await readFile(dest));
    if (diskHash !== manifest.files[relPath]) {
      skippedModified.push(relPath);
      console.warn(`skipped modified file: ${relPath}`);
      continue;
    }

    await unlink(dest);
    removed.push(relPath);
    await pruneEmptyParents(targetDir, dest);
  }

  await patchOpencodeJson(targetDir, "global", "uninstall");

  console.log(`Uninstall removed ${removed.length} managed file(s).`);
  if (removed.length > 0) {
    for (const relPath of removed) {
      console.log(`  removed: ${relPath}`);
    }
  }

  console.log(`Uninstall skipped ${skippedModified.length} modified file(s).`);
  if (skippedModified.length > 0) {
    for (const relPath of skippedModified) {
      console.log(`  skipped-modified: ${relPath}`);
    }
    console.log("Some files were skipped because they were modified; remove them manually if desired.");
  }
}

function parseFlags(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  const booleanFlags = new Set(["force", "migrate", "sandcastle-enabled", "local", "uninstall"]);
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
async function buildHeroConfigContent(targetDir, configRelPath, models, version, mode, sandcastleEnabled) {
  const path = join(targetDir, configRelPath);
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
        `${configRelPath} exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${configRelPath} must contain a JSON object at the root`);
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

async function buildManagedFileSet(targetDir, installMode, models, version, mode, sandcastleFlag) {
  /** @type {Array<{ relPath: string, contents: Buffer | string }>} */
  const files = [];

  const configRelPath = installMode === "global" ? join("hero", "config.jsonc") : join(".hero", "config.jsonc");
  const versionRelPath = installMode === "global" ? join("hero", ".hero-version") : join(".hero", ".hero-version");

  // Build the canonical .hero/config.jsonc first so we can read sandcastle.enabled out
  // of it; the value drives whether templates/.sandcastle/** is included in this run.
  const configContent = await buildHeroConfigContent(
    targetDir,
    configRelPath,
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

      if (installMode === "global") {
        if (rel.startsWith(join(".opencode", "commands") + sep) || rel === join(".opencode", "commands")) {
          continue;
        }
      }

      let relPath = rel;
      if (installMode === "global") {
        if (rel.startsWith(join(".opencode", "skills") + sep)) {
          relPath = join("skills", rel.slice(join(".opencode", "skills").length + 1));
        } else if (rel.startsWith(join(".hero") + sep)) {
          relPath = join("hero", rel.slice(join(".hero").length + 1));
        }
      }

      const buf = await readFile(src);
      files.push({ relPath, contents: buf });
    }
  }

  files.push({ relPath: versionRelPath, contents: `${version}\n` });
  files.push({ relPath: configRelPath, contents: configContent });

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
  const explicitLocal = flags.local === true;
  const uninstall = flags.uninstall === true;
  const hasPositionalTarget = positional.length > 0;
  const installMode = explicitLocal ? "local" : "global";

  if (uninstall && explicitLocal) {
    throw new Error("--uninstall supports global mode only; remove --local.");
  }

  if (hasPositionalTarget && !explicitLocal) {
    console.log("hero-init: ignoring positional target path without --local; installing globally under ~/.config/opencode.");
  }

  const targetArg = positional[0] ?? process.cwd();
  const targetDir =
    installMode === "global" ? resolve(homedir(), ".config", "opencode") : resolve(targetArg);
  const manifestRelPath = installMode === "global" ? GLOBAL_MANIFEST_REL : LOCAL_MANIFEST_REL;

  if (uninstall) {
    await uninstallGlobal(targetDir);
    return;
  }

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
  const manifest = await readManifest(targetDir, manifestRelPath);

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

  const managed = await buildManagedFileSet(targetDir, installMode, models, version, mode, sandcastleFlag);
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
  await writeManifest(targetDir, manifestRelPath, manifest);

  await patchOpencodeJson(targetDir, installMode);

  console.log(`hero-init done (version ${version})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
