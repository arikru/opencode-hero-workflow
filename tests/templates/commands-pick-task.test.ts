import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const TEMPLATE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  ".opencode",
  "commands",
  "pick-task.md",
);

// Tiny YAML frontmatter parser — mirrors the one in commands-verify.test.ts so
// these snapshot tests stay dependency-free.
function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("frontmatter: missing opening ---");
  }
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") return out;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  throw new Error("frontmatter: missing closing ---");
}

describe("templates/.opencode/commands/pick-task.md", () => {
  test("file exists and has YAML frontmatter with non-empty description", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    const fm = parseFrontmatter(text);
    expect(typeof fm.description).toBe("string");
    expect(fm.description!.length).toBeGreaterThan(0);
  });

  test("body references the pick-next-issue custom tool", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    const parts = text.split(/^---\s*$/m);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const body = parts.slice(2).join("---");
    expect(body).toContain("pick-next-issue");
  });
});
