import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const TEMPLATE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  ".opencode",
  "commands",
  "tdd.md",
);

// Same minimal frontmatter parser used by sibling command tests — kept inline
// to avoid a shared helper dependency for these snapshot checks.
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

describe("templates/.opencode/commands/tdd.md", () => {
  test("file exists and frontmatter has a non-empty description", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    const fm = parseFrontmatter(text);
    expect(typeof fm.description).toBe("string");
    expect(fm.description!.length).toBeGreaterThan(0);
  });
});
