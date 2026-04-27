import type {
  MessageUpdatedEvent,
  MessageUpdatedHook,
  SessionUpdatedEvent,
  SessionUpdatedHook,
  ToastApi,
} from "../types.ts";
import type { HeroConfig } from "../config.ts";

type TokenBudgetConfig = HeroConfig["tokenBudget"];

export interface TokenBudgetHookBundle {
  onSessionUpdated: SessionUpdatedHook;
  onMessageUpdated: MessageUpdatedHook;
}

interface SessionState {
  tokens: number;
  warned: boolean;
  alarmed: boolean;
}

// Per-PRD heuristic: ~4 chars per token. Math.ceil so empty content rounds to 0
// and tiny strings still register a non-zero token cost.
function approxTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function roundK(n: number): number {
  return Math.round(n / 1000);
}

export function createTokenBudgetHook(opts: {
  config: TokenBudgetConfig;
  toast: ToastApi;
}): TokenBudgetHookBundle {
  const { config, toast } = opts;
  // Closure state: sessionId -> running token total + already-toasted flags.
  const sessions = new Map<string, SessionState>();

  const get = (sessionId: string): SessionState => {
    let s = sessions.get(sessionId);
    if (!s) {
      s = { tokens: 0, warned: false, alarmed: false };
      sessions.set(sessionId, s);
    }
    return s;
  };

  const evaluate = async (state: SessionState): Promise<void> => {
    // Reset crossed-flags when count drops back below the threshold so the
    // toast can re-fire after a /clear or compaction.
    if (state.tokens < config.warnAt) state.warned = false;
    if (state.tokens < config.alarmAt) state.alarmed = false;

    if (state.tokens >= config.warnAt && !state.warned) {
      state.warned = true;
      const k = roundK(state.tokens);
      await toast.show({
        severity: "warn",
        message: `Approaching smart-zone limit: ~${k}K tokens. Consider /clear when this task is done.`,
      });
    }
    if (state.tokens >= config.alarmAt && !state.alarmed) {
      state.alarmed = true;
      const k = roundK(state.tokens);
      await toast.show({
        severity: "error",
        message: `Smart-zone limit exceeded: ~${k}K tokens. /clear strongly recommended.`,
      });
    }
  };

  const onSessionUpdated: SessionUpdatedHook = async (
    event: SessionUpdatedEvent,
  ) => {
    const state = get(event.sessionId);
    if (typeof event.tokenCount === "number") {
      // Authoritative count from the runtime — overrides our accumulator.
      state.tokens = event.tokenCount;
    }
    await evaluate(state);
  };

  const onMessageUpdated: MessageUpdatedHook = async (
    event: MessageUpdatedEvent,
  ) => {
    const state = get(event.sessionId);
    state.tokens += approxTokens(event.content);
    await evaluate(state);
  };

  return { onSessionUpdated, onMessageUpdated };
}
