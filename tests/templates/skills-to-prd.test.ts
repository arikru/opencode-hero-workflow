import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "templates",
  ".opencode",
  "skills",
  "hero-to-prd",
  "SKILL.md",
);

// Minimal frontmatter parser: extract the YAML block delimited by leading "---"
// lines and read simple `key: value` pairs. Mirrors the dep-free approach used
// by the sibling commands-*.test.ts files so tests stay self-contained.
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

describe("templates/.opencode/skills/hero-to-prd/SKILL.md", () => {
  test("file exists with frontmatter name === 'hero-to-prd' and non-empty description", async () => {
    const text = await Bun.file(SKILL_PATH).text();
    const fm = parseFrontmatter(text);
    expect(fm.name).toBe("hero-to-prd");
    expect(typeof fm.description).toBe("string");
    expect(fm.description!.length).toBeGreaterThan(0);
  });

  test("body contains the literal section names and the discipline phrase", async () => {
    const text = await Bun.file(SKILL_PATH).text();
    const parts = text.split(/^---\s*$/m);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const body = parts.slice(2).join("---");
    // Structural guards: these phrases must survive any future rewrite or the
    // PRD shape will silently drift away from the issue spec.
    expect(body).toContain("Problem Statement");
    expect(body).toContain("User Stories");
    expect(body).toContain("Out of Scope");
    expect(body).toContain("Synthesise, don't transcribe");
  });
});
