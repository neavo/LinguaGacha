import { describe, expect, it } from "vitest";

import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { ProjectOperationGate } from "./project-operation-gate";

describe("ProjectOperationGate", () => {
  it("后台任务 busy 时拒绝结构性项目 mutation", async () => {
    const task_runtime_state = new TaskRuntimeState();
    const gate = new ProjectOperationGate(task_runtime_state);
    task_runtime_state.begin_task("translation", { kind: "all" });

    await expect(gate.run_exclusive_project_mutation(() => "ok")).rejects.toThrow("task.busy");
    expect(() => gate.assert_task_start_allowed()).toThrow("task.busy");
  });

  it("结构性项目 mutation lease 运行期间拒绝任务启动和另一段 mutation", async () => {
    const gate = new ProjectOperationGate(new TaskRuntimeState());
    let release_mutation = (): void => {
      throw new Error("mutation lease 尚未建立");
    };
    const running_mutation = gate.run_exclusive_project_mutation(
      async () =>
        new Promise<void>((resolve) => {
          release_mutation = resolve;
        }),
    );

    expect(() => gate.assert_task_start_allowed()).toThrow("task.busy");
    await expect(gate.run_exclusive_project_mutation(() => "next")).rejects.toThrow("task.busy");

    release_mutation();
    await running_mutation;
    expect(() => gate.assert_task_start_allowed()).not.toThrow();
  });

  it("结构性项目 mutation 失败后释放 lease", async () => {
    const gate = new ProjectOperationGate(new TaskRuntimeState());

    await expect(
      gate.run_exclusive_project_mutation(() => {
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");
    await expect(gate.run_exclusive_project_mutation(() => "next")).resolves.toBe("next");
  });
});
