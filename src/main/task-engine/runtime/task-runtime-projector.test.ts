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

  it("从 project.patch 的 replace_task 回灌任务快照", () => {
    const runtime_state = new TaskRuntimeState();
    const projector = new TaskRuntimeProjector(runtime_state);

    projector.apply("project.patch", {
      patch: [
        {
          op: "replace_task",
          task: {
            task_type: "retranslate",
            status: "RUN",
            busy: true,
            request_in_flight_count: 2,
            retranslating_item_ids: [3, 5],
          },
        },
      ],
    });

    expect(runtime_state.snapshot()).toMatchObject({
      active_task_type: "retranslate",
      busy: true,
      request_in_flight_count: 2,
      retranslating_item_ids: [3, 5],
      status: "RUN",
    });
  });
});
