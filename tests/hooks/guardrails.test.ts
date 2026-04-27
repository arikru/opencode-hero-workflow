import { describe, expect, test } from "bun:test";

import {
  createGuardrailsHook,
  isEnvPath,
  isForcePushCommand,
} from "../../plugin/hooks/guardrails.ts";

const allOn = { blockEnvReads: true, blockForcePush: true } as const;

describe("isEnvPath", () => {
  test(".env is an env path", () => {
    expect(isEnvPath(".env")).toBe(true);
  });

  test(".env.local is an env path", () => {
    expect(isEnvPath(".env.local")).toBe(true);
  });

  test(".env.production.example is an env path", () => {
    expect(isEnvPath(".env.production.example")).toBe(true);
  });

  test(".envrc is an env path", () => {
    expect(isEnvPath(".envrc")).toBe(true);
  });

  test("nested subdir/.env is an env path", () => {
    expect(isEnvPath("subdir/.env")).toBe(true);
  });

  test("absolute path /repo/app/.env.local is an env path", () => {
    expect(isEnvPath("/repo/app/.env.local")).toBe(true);
  });

  test("not-an.env-file is not an env path (no dot prefix)", () => {
    expect(isEnvPath("not-an.env-file")).toBe(false);
  });

  test("package.json is not an env path", () => {
    expect(isEnvPath("package.json")).toBe(false);
  });

  test("env without leading dot is not blocked", () => {
    expect(isEnvPath("env")).toBe(false);
  });
});

describe("isForcePushCommand", () => {
  test("git push --force is a force push", () => {
    expect(isForcePushCommand("git push --force")).toBe(true);
  });

  test("git push -f is a force push", () => {
    expect(isForcePushCommand("git push -f")).toBe(true);
  });

  test("git push --force-with-lease is a force push", () => {
    expect(isForcePushCommand("git push --force-with-lease")).toBe(true);
  });

  test("git push origin main is not a force push", () => {
    expect(isForcePushCommand("git push origin main")).toBe(false);
  });

  test("git diff -f does not match (push context required)", () => {
    expect(isForcePushCommand("git diff -f")).toBe(false);
  });

  test("force push hidden behind && is detected", () => {
    expect(isForcePushCommand("cd /tmp && git push --force")).toBe(true);
  });

  test("force push hidden behind ; is detected", () => {
    expect(isForcePushCommand("echo hi; git push -f")).toBe(true);
  });

  test("force push piped is detected", () => {
    expect(isForcePushCommand("true | git push --force-with-lease")).toBe(true);
  });

  test("ls -f alone is not a force push", () => {
    expect(isForcePushCommand("ls -f")).toBe(false);
  });
});

describe("createGuardrailsHook", () => {
  test("blocks read of .env and reason mentions the path", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({ tool: "read", input: { path: ".env" } });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain(".env");
  });

  test("blocks read of .env.local", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "read",
      input: { path: ".env.local" },
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain(".env.local");
  });

  test("blocks read of .env.production.example", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "read",
      input: { path: ".env.production.example" },
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain(".env.production.example");
  });

  test("blocks read of .envrc", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({ tool: "read", input: { path: ".envrc" } });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain(".envrc");
  });

  test("blocks read of subdir/.env (nested)", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "read",
      input: { path: "subdir/.env" },
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("subdir/.env");
  });

  test("blocks view tool the same as read", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({ tool: "view", input: { path: ".env" } });
    expect(decision.allow).toBe(false);
  });

  test("read accepts filePath as a fallback input shape", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "read",
      input: { filePath: ".env" },
    });
    expect(decision.allow).toBe(false);
  });

  test("allows read of not-an.env-file (dot prefix matters)", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "read",
      input: { path: "not-an.env-file" },
    });
    expect(decision.allow).toBe(true);
  });

  test("allows read of package.json", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "read",
      input: { path: "package.json" },
    });
    expect(decision.allow).toBe(true);
  });

  test("blocks bash 'git push --force' and reason includes the command snippet", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "bash",
      input: { command: "git push --force" },
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("git push --force");
  });

  test("blocks bash 'git push -f'", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "bash",
      input: { command: "git push -f" },
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("git push -f");
  });

  test("blocks bash 'git push --force-with-lease'", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "bash",
      input: { command: "git push --force-with-lease" },
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("git push --force-with-lease");
  });

  test("allows bash 'git push origin main'", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "bash",
      input: { command: "git push origin main" },
    });
    expect(decision.allow).toBe(true);
  });

  test("allows bash 'git diff -f' (push context not present)", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "bash",
      input: { command: "git diff -f" },
    });
    expect(decision.allow).toBe(true);
  });

  test("shell tool also routes through the force push check", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "shell",
      input: { command: "git push --force" },
    });
    expect(decision.allow).toBe(false);
  });

  test("shell tool accepts cmd as a fallback input shape", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({
      tool: "shell",
      input: { cmd: "git push -f" },
    });
    expect(decision.allow).toBe(false);
  });

  test("blockEnvReads=false lets env reads pass through", async () => {
    const hook = createGuardrailsHook({
      blockEnvReads: false,
      blockForcePush: true,
    });
    const decision = await hook({ tool: "read", input: { path: ".env" } });
    expect(decision.allow).toBe(true);
  });

  test("blockForcePush=false lets force push commands pass through", async () => {
    const hook = createGuardrailsHook({
      blockEnvReads: true,
      blockForcePush: false,
    });
    const decision = await hook({
      tool: "bash",
      input: { command: "git push --force" },
    });
    expect(decision.allow).toBe(true);
  });

  test("ignores unrelated tools", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({ tool: "edit", input: { path: ".env" } });
    expect(decision.allow).toBe(true);
  });

  test("missing path on read is not a hard error — allow through", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({ tool: "read", input: {} });
    expect(decision.allow).toBe(true);
  });

  test("missing command on bash is not a hard error — allow through", async () => {
    const hook = createGuardrailsHook(allOn);
    const decision = await hook({ tool: "bash", input: {} });
    expect(decision.allow).toBe(true);
  });
});
