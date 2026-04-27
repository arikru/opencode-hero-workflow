#!/usr/bin/env bun
// hero-init: scaffolds baseline opencode-hero-workflow files into a target project.
// Scope: issues #1, #2. First-run scaffolding plus opencode.json patch plus model-role
// prompts persisted to .hero/config.jsonc.
// Out of scope here:
//   - #3: idempotent re-runs with content-hash conflict detection
//   - #4: full Zod-validated .hero/config.jsonc schema

import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "templates");

// Pinned git tag — the literal pin is the deliverable. No floating branch refs.
const PLUGIN_REF = "github:org/opencode-hero-workflow#v0.1.0";

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

async function writeFileIfAbsent(dest, contents) {
  if (existsSync(dest)) return false;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, contents);
  return true;
}

async function copyTemplates(targetDir) {
  if (!existsSync(TEMPLATES_DIR)) return;
  for (const src of walk(TEMPLATES_DIR)) {
    const rel = relative(TEMPLATES_DIR, src);
    if (rel === join(".hero", "config.jsonc")) continue;
    const dest = join(targetDir, rel);
    const buf = await readFile(src);
    const wrote = await writeFileIfAbsent(dest, buf);
    if (wrote) console.log(`wrote ${rel}`);
  }
}

async function writeHeroVersion(targetDir, version) {
  const dest = join(targetDir, ".hero", ".hero-version");
  await writeFileIfAbsent(dest, `${version}\n`);
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

  config.defaultMode = "plan";

  /** @type {string[]} */
  let plugins;
  const existingPlugins = config.plugins;
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
  config.plugins = plugins;

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(existed ? "patched opencode.json" : "wrote opencode.json");
}

function parseFlags(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  const booleanFlags = new Set();
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
// flags are prompted. No silent defaults — empty values are always rejected.
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
      throw new Error(
        `Missing --${role.key}. stdin is not a TTY; pass --implementer, --reviewer, and --planner for non-interactive runs.`,
      );
    }
    if (!rl) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
    }
    while (true) {
      const answer = (await rl.question(`${role.label} model (e.g. ${role.example}): `)).trim();
      if (answer.length > 0) {
        models[role.key] = answer;
        break;
      }
      console.log(`${role.label} model is required.`);
    }
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

// Writes .hero/config.jsonc layering the user's model selections on top of the template.
// The template owns version + defaults; this writer overwrites the models block from the
// current run.
async function writeHeroConfigWithModels(targetDir, models) {
  const path = join(targetDir, ".hero", "config.jsonc");
  const templateRaw = await readFile(join(TEMPLATES_DIR, ".hero", "config.jsonc"), "utf8");
  const templateParsed = JSON.parse(stripJsonComments(templateRaw).trim());

  /** @type {Record<string, unknown>} */
  let config = { ...templateParsed };
  if (existsSync(path)) {
    const raw = await readFile(path, "utf8");
    const stripped = stripJsonComments(raw).trim();
    try {
      const onDisk = stripped.length === 0 ? {} : JSON.parse(stripped);
      if (onDisk && typeof onDisk === "object" && !Array.isArray(onDisk)) {
        config = { ...templateParsed, ...onDisk };
      }
    } catch (err) {
      throw new Error(
        `.hero/config.jsonc exists but is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  config.models = models;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const targetArg = positional[0] ?? process.cwd();
  const targetDir = resolve(targetArg);

  const models = await collectModels(flags);

  await mkdir(targetDir, { recursive: true });

  const version = await readPackageVersion();
  await copyTemplates(targetDir);
  await writeHeroVersion(targetDir, version);
  await writeHeroConfigWithModels(targetDir, models);
  await patchOpencodeJson(targetDir);

  console.log(`hero-init done (version ${version})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
