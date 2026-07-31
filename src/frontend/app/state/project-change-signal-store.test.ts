import { describe, expect, it, vi } from "vitest";

import { createProjectChangeSignalStore } from "@frontend/app/state/project-change-signal-store";

describe("ProjectChangeSignalStore", () => {
  it("应用完整信号时同步通知现有订阅者，取消订阅后不再通知", () => {
    const store = createProjectChangeSignalStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const signal = {
      seq: 1,
      reason: "quality_updated",
      updated_sections: ["quality" as const],
      results: [],
    };

    store.applySnapshot(signal);

    expect(store.getSnapshot()).toBe(signal);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.applySnapshot({ ...signal, seq: 2 });
    expect(listener).toHaveBeenCalledOnce();
  });
});
