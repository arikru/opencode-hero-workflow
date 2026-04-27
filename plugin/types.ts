// Local minimal mirror of the OpenCode plugin contract for tool.execute.before.
// The upstream SDK is not installed; these types are shared by all plugin hooks
// so they can be unit-tested without depending on the runtime binding.

export type ToolName =
  | "read"
  | "view"
  | "edit"
  | "write"
  | "bash"
  | "shell"
  | string;

export interface ToolExecuteBeforeEvent {
  tool: ToolName;
  input: Record<string, unknown>;
}

export interface ToolDecision {
  allow: boolean;
  reason?: string;
}

export type ToolExecuteBeforeHook = (
  event: ToolExecuteBeforeEvent,
) => ToolDecision | Promise<ToolDecision>;
