// Hero's Sandcastle entry point.
//
// This file is shipped as a template by `opencode-hero-workflow`. The `init`
// scaffolder copies it to `<project>/.sandcastle/main.ts` when the user opts
// into Sandcastle. The user's `.sandcastle/package.json` is responsible for
// declaring the `sandcastle` runtime dependency — this repo does NOT install
// `sandcastle` because it is not a Hero dependency. Bun resolves the import at
// the user's project, not here.
//
// Source of authority for all configuration knobs: `.hero/config.jsonc`.
// Hero reads `models.implementer`, `models.reviewer`, and the `sandcastle.*`
// block (imageName, maxIterations, idleTimeoutSeconds, mountOpencodeAuth).
//
// OpenCode auth bind-mount: when `sandcastle.mountOpencodeAuth === true` the
// host's `~/.local/share/opencode` directory is mounted readonly into each
// sandbox so the OpenCode agent provider can authenticate inside AFK runs (PRD
// user story #22). If that directory does not exist we exit non-zero with a
// clear pointer to `opencode auth login`.
//
// Known limitation: streaming not available. Sandcastle's OpenCode provider
// returns empty `parseStreamLine` results, so per-iteration output appears in
// chunks rather than tokens. This is a documented Hero limitation tracked
// upstream (PR #375). Iteration start/end and exit status are still logged.
//
// File extension: `.template` keeps this file out of the Hero repo's
// TypeScript program — the import below references `sandcastle`, which only
// resolves in the user's `.sandcastle/` workspace.

import { sandbox } from "sandcastle";
import { homedir } from "node:os";
import { join } from "node:path";

type HeroModels = {
  implementer: string;
  reviewer: string;
  planner?: string;
};

type HeroSandcastle = {
  imageName: string;
  maxIterations: number;
  idleTimeoutSeconds: number;
  mountOpencodeAuth: boolean;
};

type HeroConfig = {
  models: HeroModels;
  sandcastle: HeroSandcastle;
};

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

async function loadHeroConfig(): Promise<HeroConfig> {
  // .hero/config.jsonc is the single source of truth (PRD user story #25).
  const text = await Bun.file(".hero/config.jsonc").text();
  const parsed = Bun.JSONC.parse(text) as HeroConfig;
  if (!parsed?.models?.implementer || !parsed.models.reviewer) {
    throw new Error("hero config: models.implementer and models.reviewer are required");
  }
  if (!parsed.sandcastle) {
    throw new Error("hero config: sandcastle block is required for AFK runs");
  }
  return parsed;
}

async function resolveAuthMount(cfg: HeroSandcastle): Promise<{ source: string; target: string } | null> {
  if (!cfg.mountOpencodeAuth) return null;
  const source = join(homedir(), ".local", "share", "opencode");
  const exists = await Bun.file(source).exists();
  if (!exists) {
    // Fail loudly — running without auth would only manifest as cryptic 401s
    // deep inside an iteration. PRD "OpenCode auth bind-mount caveat".
    console.error(
      `Hero: ~/.local/share/opencode not found at ${source}.\n` +
        `Run \`opencode auth login\` on the host before launching a Sandcastle AFK run, ` +
        `or set sandcastle.mountOpencodeAuth = false in .hero/config.jsonc to opt out.`,
    );
    process.exit(1);
  }
  return { source, target: "/root/.local/share/opencode" };
}

function buildMounts(auth: { source: string; target: string } | null) {
  if (!auth) return [];
  return [{ source: auth.source, target: auth.target, readonly: true } as const];
}

async function runAgent(opts: {
  role: "implementer" | "reviewer";
  model: string;
  cfg: HeroConfig;
  authMount: { source: string; target: string } | null;
  iteration: number;
}) {
  const { role, model, cfg, authMount, iteration } = opts;
  const startedAt = Date.now();
  console.log(`[hero] iteration ${iteration} ${role} (${model}) starting`);

  // The OpenCode agent provider reads the prompt from disk inside the sandbox.
  // .sandcastle/prompt.md is scaffolded by `init` from prompt.md.template (#22).
  const result = await sandbox.run({
    image: cfg.sandcastle.imageName,
    mounts: buildMounts(authMount),
    idleTimeoutSeconds: cfg.sandcastle.idleTimeoutSeconds,
    command: ["opencode", "run", "--model", model, "--prompt-file", ".sandcastle/prompt.md"],
    env: { HERO_ROLE: role, HERO_ITERATION: String(iteration) },
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[hero] iteration ${iteration} ${role} exited ${result.exitCode} after ${elapsed}s`);
  return result;
}

function isComplete(output: string | undefined): boolean {
  return typeof output === "string" && output.includes(COMPLETION_SIGNAL);
}

async function main() {
  const cfg = await loadHeroConfig();
  const authMount = await resolveAuthMount(cfg.sandcastle);

  console.log(
    `[hero] sandcastle starting; image=${cfg.sandcastle.imageName} ` +
      `maxIterations=${cfg.sandcastle.maxIterations} ` +
      `idleTimeoutSeconds=${cfg.sandcastle.idleTimeoutSeconds} ` +
      `mountOpencodeAuth=${cfg.sandcastle.mountOpencodeAuth}`,
  );

  // parallel-planner-with-review: the implementer drives the issue board, the
  // reviewer audits each pass. Each iteration spawns both in parallel and
  // waits for both before checking the COMPLETE signal.
  for (let iteration = 1; iteration <= cfg.sandcastle.maxIterations; iteration++) {
    const [impl, review] = await Promise.all([
      runAgent({ role: "implementer", model: cfg.models.implementer, cfg, authMount, iteration }),
      runAgent({ role: "reviewer", model: cfg.models.reviewer, cfg, authMount, iteration }),
    ]);

    if (isComplete(impl.stdout) || isComplete(review.stdout)) {
      console.log(`[hero] ${COMPLETION_SIGNAL} observed; stopping after iteration ${iteration}`);
      return;
    }
  }

  console.log(`[hero] reached maxIterations=${cfg.sandcastle.maxIterations}; stopping`);
}

main().catch((err) => {
  console.error(`[hero] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
