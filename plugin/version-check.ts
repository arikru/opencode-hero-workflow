// Startup version-drift check. Compares the installed npm package version
// against the version scaffolded into `.hero/.hero-version` by `bin/init.js`,
// surfacing a toast when they disagree so the user knows to re-run init.
//
// Scope: issue #12 / user story 19. The plugin entry point should call
// `checkVersionDrift` from its init phase as fire-and-forget — it must never
// throw or block plugin startup.

import { readFile } from "node:fs/promises";

import type { ToastApi } from "./types.ts";

interface NodeError extends Error {
  code?: string;
}

export async function readScaffoldVersion(
  path: string,
): Promise<string | null> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.trim();
  } catch (err) {
    if ((err as NodeError).code === "ENOENT") {
      return null;
    }
    // Any non-ENOENT failure (permissions, IO) is logged and swallowed; a
    // version-drift check must never crash plugin startup.
    console.error(
      `hero version-check: failed to read ${path}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export async function checkVersionDrift(opts: {
  packageVersion: string;
  scaffoldedVersionPath: string;
  toast: ToastApi;
}): Promise<void> {
  const scaffolded = await readScaffoldVersion(opts.scaffoldedVersionPath);
  if (scaffolded === null) {
    return;
  }
  // Exact-string compare: the package pins itself to a literal git tag, so any
  // semver-aware comparison would only obscure mismatches the user cares about.
  if (scaffolded === opts.packageVersion) {
    return;
  }
  const message =
    `Hero version drift: scaffold v${scaffolded}, package v${opts.packageVersion}. ` +
    `Run \`bunx github:org/opencode-hero-workflow#v${opts.packageVersion} init --migrate\` to sync.`;
  await opts.toast.show({ message, severity: "warn" });
}
