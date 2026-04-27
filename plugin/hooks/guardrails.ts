import { basename } from "node:path";

import type {
  ToolDecision,
  ToolExecuteBeforeEvent,
  ToolExecuteBeforeHook,
} from "../types.ts";

type GuardrailsConfig = {
  blockEnvReads: boolean;
  blockForcePush: boolean;
};

// Exported for direct unit-testing of the matcher without needing the closure.
// Matches `.env`, `.env.<anything>`, and `.envrc`. Path nesting is respected
// because we work on the basename only.
export function isEnvPath(path: string): boolean {
  const name = basename(path);
  return name === ".env" || name === ".envrc" || name.startsWith(".env.");
}

// Exported for direct unit-testing. We block all force variants — including
// `--force-with-lease`, because while it is "safer" than `--force`, it still
// rewrites remote history and is destructive in an AFK context.
export function isForcePushCommand(cmd: string): boolean {
  // Split on shell separators so `cd /tmp && git push --force` is caught.
  const segments = cmd.split(/&&|\|\||;|\|/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    // Find a `git push` adjacency, then look for force flags after it.
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === "git" && tokens[i + 1] === "push") {
        const rest = tokens.slice(i + 2);
        if (
          rest.some(
            (t) =>
              t === "--force" || t === "--force-with-lease" || t === "-f",
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

const READ_TOOLS = new Set(["read", "view"]);
const SHELL_TOOLS = new Set(["bash", "shell"]);

function extractPath(input: Record<string, unknown>): string | undefined {
  const p = input.path ?? input.filePath;
  return typeof p === "string" ? p : undefined;
}

function extractCommand(input: Record<string, unknown>): string | undefined {
  const c = input.command ?? input.cmd;
  return typeof c === "string" ? c : undefined;
}

const ALLOW: ToolDecision = { allow: true };

export function createGuardrailsHook(
  cfg: GuardrailsConfig,
): ToolExecuteBeforeHook {
  return (event: ToolExecuteBeforeEvent): ToolDecision => {
    if (cfg.blockEnvReads && READ_TOOLS.has(event.tool)) {
      const path = extractPath(event.input);
      if (path !== undefined && isEnvPath(path)) {
        return {
          allow: false,
          reason: `guardrails: refusing to read env file '${path}' (contains secrets).`,
        };
      }
    }

    if (cfg.blockForcePush && SHELL_TOOLS.has(event.tool)) {
      const cmd = extractCommand(event.input);
      if (cmd !== undefined && isForcePushCommand(cmd)) {
        return {
          allow: false,
          reason: `guardrails: refusing to run force push: '${cmd}'`,
        };
      }
    }

    return ALLOW;
  };
}
