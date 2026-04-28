import { describe, expect, it } from "vitest";

import {
  is_task_snapshot_for_runtime,
  should_defer_runtime_snapshot_refresh,
} from "@/pages/workbench-page/task-runtime/task-runtime-ownership";

describe("task-runtime-ownership", () => {
  it("只把快照交给匹配的任务运行态", () => {
    expect(
      is_task_snapshot_for_runtime(
        {
          task_type: "translation",
        },
        "translation",
      ),
    ).toBe(true);
    expect(
      is_task_snapshot_for_runtime(
        {
          task_type: "analysis",
        },
        "translation",
      ),
    ).toBe(false);
  });

  it("只在其他任务忙碌时延后当前运行态刷新", () => {
    expect(
      should_defer_runtime_snapshot_refresh(
        {
          task_type: "analysis",
          busy: true,
        },
        "translation",
      ),
    ).toBe(true);
    expect(
      should_defer_runtime_snapshot_refresh(
        {
          task_type: "analysis",
          busy: false,
        },
        "translation",
      ),
    ).toBe(false);
    expect(
      should_defer_runtime_snapshot_refresh(
        {
          task_type: "translation",
          busy: true,
        },
        "translation",
      ),
    ).toBe(false);
  });
});
