import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// The template ships in the package as a non-.ts file so it is not type-checked
// against our tsconfig (it depends on `sandcastle` which is the user's project
// dependency, not ours). These tests verify only structural invariants.
const TEMPLATE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "sandcastle",
  "main.ts.template",
);

describe("sandcastle/main.ts.template", () => {
  test("file exists at sandcastle/main.ts.template", () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });

  test("references the Hero config keys it depends on", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("models.implementer");
    expect(text).toContain("models.reviewer");
    expect(text).toContain("mountOpencodeAuth");
    expect(text).toContain("maxIterations");
    expect(text).toContain("idleTimeoutSeconds");
  });

  test("references the OpenCode auth host directory", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    // Either the tilde form in a comment or the resolved suffix in code is fine.
    const hasReference =
      text.includes("~/.local/share/opencode") || text.includes(".local/share/opencode");
    expect(hasReference).toBe(true);
  });

  test("checks the PRD's <promise>COMPLETE</promise> termination signal", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    expect(text).toContain("<promise>COMPLETE</promise>");
  });

  test("first non-comment line imports from \"sandcastle\"", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    const lines = text.split("\n");
    let firstCode: string | undefined;
    let inBlockComment = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.startsWith("/*")) {
        if (!line.includes("*/")) inBlockComment = true;
        continue;
      }
      if (line.startsWith("//")) continue;
      firstCode = line;
      break;
    }
    expect(firstCode).toBeDefined();
    expect(firstCode!).toMatch(/^import\b[^;]*from\s+["']sandcastle["']/);
  });

  test("header comment acknowledges the known limitations", async () => {
    const text = await Bun.file(TEMPLATE_PATH).text();
    // Pull just the leading comment block so we are checking the header,
    // not stray uses elsewhere in the file.
    const lines = text.split("\n");
    const headerLines: string[] = [];
    let inBlockComment = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) {
        if (headerLines.length === 0) continue;
        if (!inBlockComment) break;
        headerLines.push(raw);
        continue;
      }
      if (inBlockComment) {
        headerLines.push(raw);
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.startsWith("/*")) {
        headerLines.push(raw);
        if (!line.includes("*/")) inBlockComment = true;
        continue;
      }
      if (line.startsWith("//")) {
        headerLines.push(raw);
        continue;
      }
      break;
    }
    const header = headerLines.join("\n");
    expect(header).toContain("OpenCode auth bind-mount");
    expect(header).toContain("streaming not available");
  });
});
