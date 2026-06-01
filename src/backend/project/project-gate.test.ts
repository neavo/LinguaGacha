import { describe, expect, it } from "vitest";
import { TaskRunState } from "../engine/run/task-run-state";
import { ProjectOperationGate } from "./project-gate";

describe("ProjectOperationGate", () => {
  it("后台任务 busy 时拒绝结构性项目 write", async () => {
    const task_run_state = new TaskRunState();
    const gate = new ProjectOperationGate(task_run_state);
    task_run_state.begin_task("translation", { kind: "all" });

    await expect(gate.run_exclusive_project_write(() => "ok")).rejects.toThrow("task.busy");
    expect(() => gate.assert_task_start_allowed()).toThrow("task.busy");
  });

  it("结构性项目写入租约运行期间拒绝任务启动和另一段写入", async () => {
    const gate = new ProjectOperationGate(new TaskRunState());
    let release_write = (): void => {
      throw new Error("写入租约尚未建立");
    };
    const running_write = gate.run_exclusive_project_write(
      async () =>
        new Promise<void>((resolve) => {
          release_write = resolve;
        }),
    );

    expect(() => gate.assert_task_start_allowed()).toThrow("task.busy");
    await expect(gate.run_exclusive_project_write(() => "next")).rejects.toThrow("task.busy");

    release_write();
    await running_write;
    expect(() => gate.assert_task_start_allowed()).not.toThrow();
  });

  it("结构性项目 write 失败后释放 lease", async () => {
    const gate = new ProjectOperationGate(new TaskRunState());

    await expect(
      gate.run_exclusive_project_write(() => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
    await expect(gate.run_exclusive_project_write(() => "next")).resolves.toBe("next");
  });
});
