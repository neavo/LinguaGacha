import { describe, expect, it } from "vitest";

import { createTaskSnapshotStore } from "./task-snapshot-store";
import type { TaskSnapshot } from "./task-snapshot-store";

function create_task_snapshot(run_revision: number, status: string, line = 0): TaskSnapshot {
  return {
    run_revision,
    task_type: "translation",
    status,
    busy: status === "requested" || status === "running" || status === "stopping",
    request_in_flight_count: 0,
    progress: {
      line,
      total_line: line,
      processed_line: line,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
    },
    extras: { kind: "translation", scope: { kind: "all" } },
  };
}

describe("createTaskSnapshotStore", () => {
  it("拒绝旧 state revision 的任务快照回退", () => {
    const store = createTaskSnapshotStore();

    store.applySnapshot(create_task_snapshot(3, "done"));
    store.applySnapshot(create_task_snapshot(2, "requested"));

    expect(store.getSnapshot()).toMatchObject({
      run_revision: 3,
      status: "done",
      busy: false,
    });
  });

  it("工程 B 的 idle 快照会拒绝随后到达的工程 A 终态帧", () => {
    const store = createTaskSnapshotStore();
    const delayed_a_terminal = create_task_snapshot(7, "done", 4);

    store.applySnapshot(delayed_a_terminal);
    store.applySnapshot(create_task_snapshot(8, "idle", 2));
    store.applySnapshot(delayed_a_terminal);

    expect(store.getSnapshot()).toMatchObject({
      run_revision: 8,
      status: "idle",
      busy: false,
      progress: {
        line: 2,
      },
    });
  });
});
