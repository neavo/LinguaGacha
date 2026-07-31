import { describe, expect, it, vi } from "vitest";

import {
  createRuntimeActivityStore,
  is_runtime_busy,
  normalize_runtime_activity_snapshot,
} from "./runtime-activity-store";

describe("runtime-activity-store", () => {
  it("把不可信载荷收窄为合法运行时快照", () => {
    expect(
      normalize_runtime_activity_snapshot({ runtime: { revision: 3, owner: "task" } }),
    ).toEqual({ revision: 3, owner: "task" });
    expect(
      normalize_runtime_activity_snapshot({
        runtime: { revision: "3", owner: "invalid" },
      }),
    ).toEqual({ revision: 0, owner: null });
  });

  it("只应用不旧于当前 revision 的快照并通知订阅者", () => {
    const store = createRuntimeActivityStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.applySnapshot({ revision: 2, owner: "agent" });
    store.applySnapshot({ revision: 1, owner: null });

    expect(store.getSnapshot()).toEqual({ revision: 2, owner: "agent" });
    expect(is_runtime_busy(store.getSnapshot())).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });
});
