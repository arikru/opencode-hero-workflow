import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type VerifyResult = { passed: boolean; output: string };

export type ScriptExistsFn = (path: string) => boolean;

export const PACKAGE_VERIFY_SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/verify.sh", import.meta.url),
);

export function resolveVerifyScriptPath(
  projectRoot: string,
  scriptExists: ScriptExistsFn = existsSync,
): string {
  const projectScriptPath = join(projectRoot, "scripts", "verify.sh");
  if (scriptExists(projectScriptPath)) {
    return projectScriptPath;
  }
  return PACKAGE_VERIFY_SCRIPT_PATH;
}

export function toVerifyResult(
  exitCode: number,
  stdout: string,
  stderr: string,
): VerifyResult {
  const output = stderr.length > 0 ? `${stdout}\n${stderr}` : stdout;
  return { passed: exitCode === 0, output };
}
