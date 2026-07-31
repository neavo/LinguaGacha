import { describe, expect, it } from "vitest";

import { RuntimeOperationGate } from "./runtime-operation-gate";

describe("RuntimeOperationGate", () => {
  it("普通任务与 Agent 共享单一运行租约并发布单调快照", () => {
    const gate = new RuntimeOperationGate();
    const snapshots: unknown[] = [];
    gate.subscribe((snapshot) => snapshots.push(snapshot));

    const lease = gate.begin_runtime("agent");
    expect(gate.get_snapshot()).toEqual({ revision: 1, owner: "agent" });
    expect(() => gate.begin_runtime("task")).toThrow("runtime.busy");
    gate.finish_runtime(lease);

    expect(gate.get_snapshot()).toEqual({ revision: 2, owner: null });
    expect(snapshots).toEqual([
      { revision: 1, owner: "agent" },
      { revision: 2, owner: null },
    ]);
  });

  it("项目写入与模型运行互斥", async () => {
    const gate = new RuntimeOperationGate();
    let release_write = (): void => undefined;
    const running_write = gate.run_project_write(
      async () =>
        new Promise<void>((resolve) => {
          release_write = resolve;
        }),
    );

    expect(() => gate.begin_runtime("task")).toThrow("runtime.busy");
    await expect(gate.run_project_write(() => undefined)).rejects.toThrow("runtime.busy");
    release_write();
    await running_write;

    const runtime_lease = gate.begin_runtime("task");
    await expect(gate.run_project_write(() => undefined)).rejects.toThrow("runtime.busy");
    gate.finish_runtime(runtime_lease);
  });

  it("项目写失败后释放写租约", async () => {
    const gate = new RuntimeOperationGate();

    await expect(
      gate.run_project_write(() => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");

    await expect(gate.run_project_write(() => "next")).resolves.toBe("next");
  });

  it("Agent 项目写只在 Agent 运行租约内放行", async () => {
    const gate = new RuntimeOperationGate();

    await expect(gate.run_agent_project_write(() => undefined)).rejects.toThrow("runtime.busy");
    const lease = gate.begin_runtime("agent");
    await expect(gate.run_agent_project_write(() => "ok")).resolves.toBe("ok");
    gate.finish_runtime(lease);
  });

  it("迟到清理不能释放后续运行租约", () => {
    const gate = new RuntimeOperationGate();
    const stale_lease = gate.begin_runtime("task");
    gate.finish_runtime(stale_lease);
    const current_lease = gate.begin_runtime("agent");

    gate.finish_runtime(stale_lease);

    expect(gate.get_snapshot()).toEqual({ revision: 3, owner: "agent" });
    gate.finish_runtime(current_lease);
  });
});
