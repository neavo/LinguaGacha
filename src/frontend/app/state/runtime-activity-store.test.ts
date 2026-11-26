import { describe, expect, it, vi } from "vitest";

import { createRuntimeActivityStore } from "./runtime-activity-store";

describe("runtime-activity-store", () => {
  it("只应用不旧于当前 revision 的快照并通知订阅者", () => {
    const store = createRuntimeActivityStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const latest = {
      revision: 2,
      owner: "agent",
      projects: {
        project: {
          agent: true,
          batchTranslation: false,
          projectWrite: false,
          lastAgentRoundStartedAt: 20,
        },
      },
    };
    store.applySnapshot(latest);
    store.applySnapshot({ revision: 1, owner: null });

    expect(store.getSnapshot()).toMatchObject(latest);
    expect(listener).toHaveBeenCalledOnce();
  });
});
