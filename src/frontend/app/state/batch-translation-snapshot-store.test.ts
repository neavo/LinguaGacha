import { describe, expect, it } from "vitest";

import { createBatchTranslationSnapshotStore } from "./batch-translation-snapshot-store";
import type { BatchTranslationSnapshot } from "@domain/batch-translation";

function create_task_snapshot(
  revision: number,
  status: BatchTranslationSnapshot["status"],
  line = 0,
): BatchTranslationSnapshot {
  return {
    revision,
    status,
    request_in_flight_count: 0,
    progress: {
      line,
      total_line: line,
      processed_line: line,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_reasoning_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
    },
    scope: { kind: "all" },
  };
}

describe("createBatchTranslationSnapshotStore", () => {
  it("拒绝旧 state revision 的任务快照回退", () => {
    const store = createBatchTranslationSnapshotStore();

    store.applySnapshot(create_task_snapshot(3, "done"));
    store.applySnapshot(create_task_snapshot(2, "requested"));

    expect(store.getSnapshot()).toMatchObject({
      revision: 3,
      status: "done",
    });
  });

  it("工程 B 的 idle 快照会拒绝随后到达的工程 A 终态帧", () => {
    const store = createBatchTranslationSnapshotStore();
    const delayed_a_terminal = create_task_snapshot(7, "done", 4);

    store.applySnapshot(delayed_a_terminal);
    store.applySnapshot(create_task_snapshot(8, "idle", 2));
    store.applySnapshot(delayed_a_terminal);

    expect(store.getSnapshot()).toMatchObject({
      revision: 8,
      status: "idle",
      progress: {
        line: 2,
      },
    });
  });
});
