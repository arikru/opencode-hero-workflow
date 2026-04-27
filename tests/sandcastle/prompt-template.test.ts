import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const TEMPLATE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "sandcastle",
  "prompt.md.template",
);

describe("sandcastle/prompt.md.template", () => {
  test("file exists and body is non-empty (>500 bytes)", async () => {
    const file = Bun.file(TEMPLATE_PATH);
    expect(await file.exists()).toBe(true);
    const text = await file.text();
    expect(text.length).toBeGreaterThan(500);
  });

  test("references the hero-tdd-loop skill", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("hero-tdd-loop");
  });

  test("references the hero-reviewer-standards skill", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("hero-reviewer-standards");
  });

  test("contains the templated {{ISSUE_NUMBER}} placeholder", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("{{ISSUE_NUMBER}}");
  });

  test("uses gh issue view to load issue context", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("gh issue view");
  });

  test("contains the COMPLETE termination tag", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("<promise>COMPLETE</promise>");
  });

  test("contains the BLOCKED termination tag prefix", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("<promise>BLOCKED");
  });
});
