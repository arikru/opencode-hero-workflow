import { describe, expect, test } from "bun:test";

import { createTokenBudgetHook } from "../../plugin/hooks/token-budget.ts";
import type { HeroConfig } from "../../plugin/config.ts";
import type { ToastApi } from "../../plugin/types.ts";

type ToastCall = {
  message: string;
  severity?: "info" | "warn" | "error";
};

function createFakeToast(): { toast: ToastApi; calls: ToastCall[] } {
  const calls: ToastCall[] = [];
  const toast: ToastApi = {
    show(opts) {
      calls.push(opts);
    },
  };
  return { toast, calls };
}

const defaultBudget: HeroConfig["tokenBudget"] = {
  warnAt: 80000,
  alarmAt: 100000,
};

describe("createTokenBudgetHook — session.updated with tokenCount", () => {
  test("below warnAt: no toast fires", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 1000 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 79999 });
    expect(calls.length).toBe(0);
  });

  test("crossing warnAt fires a single warn toast", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 70000 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    expect(calls.length).toBe(1);
    expect(calls[0].severity).toBe("warn");
    expect(calls[0].message).toContain("80K");
    expect(calls[0].message).toContain("/clear");
  });

  test("multiple updates above warnAt after the cross: no additional toast", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 85000 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 90000 });
    expect(calls.length).toBe(1);
  });

  test("crossing alarmAt fires an error toast", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 100001 });
    expect(calls.length).toBe(2);
    expect(calls[0].severity).toBe("warn");
    expect(calls[1].severity).toBe("error");
    expect(calls[1].message).toContain("100K");
    expect(calls[1].message).toContain("/clear");
  });

  test("alarm-only update from below warn fires both toasts", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 1000 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 100001 });
    const severities = calls.map((c) => c.severity);
    expect(severities).toContain("warn");
    expect(severities).toContain("error");
  });

  test("dropping below warnAt then crossing again re-fires the warn toast", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    expect(calls.length).toBe(1);
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 5000 });
    expect(calls.length).toBe(1);
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80500 });
    expect(calls.length).toBe(2);
    expect(calls[1].severity).toBe("warn");
  });

  test("two distinct sessionIds have independent crossed-state", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    await hook.onSessionUpdated({ sessionId: "s2", tokenCount: 80001 });
    expect(calls.length).toBe(2);
    expect(calls[0].severity).toBe("warn");
    expect(calls[1].severity).toBe("warn");
  });

  test("dropping below alarmAt but still above warnAt then crossing alarm again re-fires", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 100001 });
    expect(calls.filter((c) => c.severity === "error").length).toBe(1);
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 90000 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 100500 });
    expect(calls.filter((c) => c.severity === "error").length).toBe(2);
  });

  test("toast message does not contain the word 'approximate'", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 100001 });
    for (const c of calls) {
      expect(c.message.toLowerCase()).not.toContain("approximate");
    }
  });
});

describe("createTokenBudgetHook — message.updated accumulation", () => {
  test("when tokenCount absent, accumulates from message.updated via length/4", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    // 320004 chars -> 80001 tokens via Math.ceil(len/4)
    const big = "x".repeat(320004);
    await hook.onMessageUpdated({
      sessionId: "s1",
      messageId: "m1",
      content: big,
    });
    expect(calls.length).toBe(1);
    expect(calls[0].severity).toBe("warn");
  });

  test("multiple message.updated events accumulate into the same session total", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    // 4 * 70000 = 280000 chars -> 70000 tokens (below warn)
    await hook.onMessageUpdated({
      sessionId: "s1",
      messageId: "m1",
      content: "x".repeat(280000),
    });
    expect(calls.length).toBe(0);
    // +4 * 11000 = 44000 chars -> +11000 tokens => 81000 (crosses warn)
    await hook.onMessageUpdated({
      sessionId: "s1",
      messageId: "m2",
      content: "x".repeat(44000),
    });
    expect(calls.length).toBe(1);
    expect(calls[0].severity).toBe("warn");
  });

  test("message.updated accumulator is per-session", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    await hook.onMessageUpdated({
      sessionId: "s1",
      messageId: "m1",
      content: "x".repeat(160000), // 40000 tokens
    });
    await hook.onMessageUpdated({
      sessionId: "s2",
      messageId: "m2",
      content: "x".repeat(160000), // 40000 tokens
    });
    expect(calls.length).toBe(0);
  });
});

describe("createTokenBudgetHook — tokenCount on event takes precedence", () => {
  test("session.updated tokenCount is used when present (overrides accumulator)", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({ config: defaultBudget, toast });
    // First, accumulate some via message.updated (well below warn).
    await hook.onMessageUpdated({
      sessionId: "s1",
      messageId: "m1",
      content: "x".repeat(40000), // 10000 tokens
    });
    expect(calls.length).toBe(0);
    // Now session.updated with explicit tokenCount above warn.
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 80001 });
    expect(calls.length).toBe(1);
    expect(calls[0].severity).toBe("warn");
  });

  test("custom warnAt and alarmAt are respected", async () => {
    const { toast, calls } = createFakeToast();
    const hook = createTokenBudgetHook({
      config: { warnAt: 50000, alarmAt: 60000 },
      toast,
    });
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 49999 });
    expect(calls.length).toBe(0);
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 50001 });
    expect(calls.length).toBe(1);
    expect(calls[0].severity).toBe("warn");
    expect(calls[0].message).toContain("50K");
    await hook.onSessionUpdated({ sessionId: "s1", tokenCount: 60001 });
    expect(calls.length).toBe(2);
    expect(calls[1].severity).toBe("error");
    expect(calls[1].message).toContain("60K");
  });
});
