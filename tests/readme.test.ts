import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Structural guard for the project README. We do not assert prose: only that
// the high-level shape (sections, install one-liner, slash commands) is
// present, so future edits cannot silently drop the operational pieces a new
// user needs to find.

const README_PATH = join(import.meta.dir, "..", "README.md");

function readReadme(): string {
  return readFileSync(README_PATH, "utf8");
}

const REQUIRED_H2_SECTIONS = [
  "What is Hero?",
  "Install",
  "Configuration",
  "Day-shift commands",
  "Night-shift",
  "Stack support",
  "Hooks the plugin installs",
  "Known limitations",
  "Upgrading",
  "Contributing",
];

const REQUIRED_SLASH_COMMANDS = [
  "/grill",
  "/prd",
  "/kanban",
  "/pick-task",
  "/tdd",
  "/verify",
  "/review",
  "/architecture-scan",
  "/context-status",
  "/mark-issue-done",
  "/ralph",
];

describe("README.md", () => {
  test("file exists at the repo root", () => {
    expect(existsSync(README_PATH)).toBe(true);
  });

  test("contains every required H2 section in order", () => {
    const body = readReadme();
    let cursor = 0;
    for (const heading of REQUIRED_H2_SECTIONS) {
      // Match the literal "## " prefix so we do not pick up H1/H3 hits.
      const needle = `## ${heading}`;
      const found = body.indexOf(needle, cursor);
      expect(found, `missing or out-of-order H2: ${heading}`).toBeGreaterThan(
        -1,
      );
      cursor = found + needle.length;
    }
  });

  test("contains a fenced code block with the bunx install one-liner", () => {
    const body = readReadme();
    // Find every fenced code block and check at least one carries an
    // install one-liner. We accept either the npm form
    // (`bunx opencode-hero-workflow[@version] init`) or the GitHub form
    // (`bunx github:owner/repo[#ref] init`) so README authors can switch
    // between distribution channels without breaking the structural guard.
    const blocks = body.split(/```/);
    // Even-indexed entries are outside fences; odd-indexed are inside.
    const fenced = blocks.filter((_, idx) => idx % 2 === 1);
    const installPattern =
      /bunx\s+(opencode-hero-workflow(@[^\s]+)?|github:[^\s]+)\s+[^\n`]*\binit\b/;
    const hasInstall = fenced.some((block) => installPattern.test(block));
    expect(hasInstall).toBe(true);
  });

  test("documents every Hero slash command literally", () => {
    const body = readReadme();
    for (const cmd of REQUIRED_SLASH_COMMANDS) {
      expect(body, `missing slash command in README: ${cmd}`).toContain(cmd);
    }
  });
});
