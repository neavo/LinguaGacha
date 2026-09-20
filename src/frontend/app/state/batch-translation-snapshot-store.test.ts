import { create_empty_batch_translation_snapshot } from "@shared/batch-translation/batch-translation";
import { describe, expect, it } from "vitest";

import { createBatchTranslationSnapshotStore } from "./batch-translation-snapshot-store";
import type { BatchTranslationSnapshot } from "@domain/batch-translation";

/** 构造不同版本的任务快照，验证接收顺序。 */
function create_task_snapshot(
  revision: number,
  status: BatchTranslationSnapshot["status"],
  line = 0,
): BatchTranslationSnapshot {
  const snapshot = create_empty_batch_translation_snapshot();
  return {
    ...snapshot,
    revision,
    status,
    source: status === "idle" ? null : "standalone",
    progress: { ...snapshot.progress, line, total_line: line, processed_line: line },
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
