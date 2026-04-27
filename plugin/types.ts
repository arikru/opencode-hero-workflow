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

// Minimal mirror of OpenCode's toast surface (`tui.toast.show`). Hooks that
// want to surface a user-visible message accept a `ToastApi` so tests can pass
// in a spy without standing up the OpenCode runtime.
export interface ToastApi {
  show(opts: {
    message: string;
    severity?: "info" | "warn" | "error";
  }): void | Promise<void>;
}

// `tool.execute.after` — fires after a tool call completes. Used by the verify
// hook to react to edit/write completions and (later) by metric collectors.
export interface ToolExecuteAfterEvent {
  tool: ToolName;
  input: Record<string, unknown>;
  output: { success: boolean; result?: unknown; error?: string };
}

export type ToolExecuteAfterHook = (
  event: ToolExecuteAfterEvent,
) => void | Promise<void>;

// `session.updated` / `message.updated` — fire as the session's token usage
// changes. Token-budget guard listens here. `tokenCount` is approximate by design.
export interface SessionUpdatedEvent {
  sessionId: string;
  tokenCount?: number;
  messageCount?: number;
}

export type SessionUpdatedHook = (
  event: SessionUpdatedEvent,
) => void | Promise<void>;

export interface MessageUpdatedEvent {
  sessionId: string;
  messageId: string;
  content: string;
}

export type MessageUpdatedHook = (
  event: MessageUpdatedEvent,
) => void | Promise<void>;

// `session.compacted` fires after compaction; `experimental.session.compacting`
// fires before, letting a plugin inject continuation context.
export interface SessionCompactedEvent {
  sessionId: string;
  before?: { tokenCount: number };
  after?: { tokenCount: number };
}

export type SessionCompactedHook = (
  event: SessionCompactedEvent,
) => void | Promise<void>;

export interface SessionCompactingEvent {
  sessionId: string;
}

export interface CompactingContext {
  prdPath: string | null;
  activeIssueId: string | null;
}

export type SessionCompactingHook = (
  event: SessionCompactingEvent,
) => CompactingContext | Promise<CompactingContext>;

// `client.app.log` — used by hooks to surface long-form output (e.g. verify
// results) without spamming the user via toasts.
export interface AppLogApi {
  log(opts: {
    level: "info" | "warn" | "error";
    message: string;
    detail?: string;
  }): void | Promise<void>;
}

// Custom tools registered via the OpenCode plugin API. Tests construct them
// directly and assert on the result of `execute(input)`.
export interface CustomTool<
  TInput = Record<string, unknown>,
  TOutput = unknown,
> {
  name: string;
  description: string;
  inputSchema?: unknown;
  execute(input: TInput): TOutput | Promise<TOutput>;
}
