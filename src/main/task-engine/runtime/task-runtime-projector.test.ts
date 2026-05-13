import { describe, expect, it } from "vitest";

import { TaskRuntimeProjector } from "./task-runtime-projector";
import { TaskRuntimeState } from "./task-runtime-state";

describe("TaskRuntimeProjector", () => {
  it("从 task.status_changed 投影任务运行态", () => {
    const runtime_state = new TaskRuntimeState();
    const projector = new TaskRuntimeProjector(runtime_state);

    projector.apply("task.status_changed", {
      task_type: "translation",
      status: "RUN",
      busy: true,
    });

    expect(runtime_state.snapshot()).toMatchObject({
      active_task_type: "translation",
      busy: true,
      status: "RUN",
    });
  });

  it("项目数据变更不会回灌任务运行态", () => {
    const runtime_state = new TaskRuntimeState();
    const projector = new TaskRuntimeProjector(runtime_state);

    projector.apply("project.data_changed", {
      updatedSections: ["items"],
    });

    expect(runtime_state.snapshot()).toMatchObject({ busy: false, status: "IDLE" });
  });
});
