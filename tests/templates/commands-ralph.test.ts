import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const TEMPLATE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  ".opencode",
  "commands",
  "ralph.md",
);

// Tiny YAML frontmatter parser — mirrors siblings to stay dependency-free.
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

function bodyOf(text: string): string {
  const parts = text.split(/^---\s*$/m);
  expect(parts.length).toBeGreaterThanOrEqual(3);
  return parts.slice(2).join("---");
}

describe("templates/.opencode/commands/ralph.md", () => {
  test("file exists and frontmatter has a non-empty description", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    const fm = parseFrontmatter(text);
    expect(typeof fm.description).toBe("string");
    expect(fm.description!.length).toBeGreaterThan(0);
  });

  test("body covers the load-bearing pre-flight and run contract", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    const body = bodyOf(text);
    expect(body).toContain("sandcastle.enabled");
    expect(body).toContain("bunx sandcastle");
    expect(body).toContain("pick-next-issue");
    expect(body).toContain("<promise>COMPLETE</promise>");
    expect(body).toContain("mark-issue-done");
    expect(body).toContain("OpenCode auth");
    expect(body).toContain("issue board");
  });
});
