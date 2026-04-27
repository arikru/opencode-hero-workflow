#!/usr/bin/env bun
// hero-init: scaffolds baseline opencode-hero-workflow files into a target project.
// Scope: issue #1. First-run scaffolding plus opencode.json patch.
// Out of scope here:
//   - #2: model-role prompts persisted into .hero/config.jsonc
//   - #3: idempotent re-runs with content-hash conflict detection
//   - #4: full Zod-validated .hero/config.jsonc schema

import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "templates");

// Pinned git tag — the literal pin is the deliverable. No floating branch refs.
const PLUGIN_REF = "github:org/opencode-hero-workflow#v0.1.0";

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

async function main() {
  const targetArg = process.argv[2] ?? process.cwd();
  const targetDir = resolve(targetArg);

  await mkdir(targetDir, { recursive: true });

  const version = await readPackageVersion();
  await copyTemplates(targetDir);
  await writeHeroVersion(targetDir, version);
  await patchOpencodeJson(targetDir);

  console.log(`hero-init done (version ${version})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
