import { describe, expect, it } from "vitest";

import { createTaskSnapshotStore, normalize_task_snapshot } from "./task-snapshot-store";

describe("normalize_task_snapshot", () => {
  it("保留完整翻译 scope", () => {
    const snapshot = normalize_task_snapshot({
      task: {
        extras: {
          kind: "translation",
          scope: {
            kind: "all",
          },
        },
      },
    });

    expect(snapshot.extras).toEqual({ kind: "translation", scope: { kind: "all" } });
  });

  it("重翻 item id 只保留去重后的正整数", () => {
    const snapshot = normalize_task_snapshot({
      task: {
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [2, 0, -1, "3", "bad", 2] as unknown as number[],
          },
        },
      },
    });

    expect(snapshot.extras).toMatchObject({ scope: { kind: "items", item_ids: [2, 3] } });
  });

  it("显式空重翻 scope 会保留局部重翻场景", () => {
    const snapshot = normalize_task_snapshot({
      task: {
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [],
          },
        },
      },
    });

    expect(snapshot.extras).toEqual({
      kind: "translation",
      scope: { kind: "items", item_ids: [] },
    });
  });

  it("非法重翻 scope 会归一为完整翻译", () => {
    const invalid_scope_snapshot = normalize_task_snapshot({
      task: {
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [0, -1, "bad"] as unknown as number[],
          },
        },
      },
    });
    const missing_scope_snapshot = normalize_task_snapshot({
      task: {
        extras: {
          kind: "translation",
          scope: {
            kind: "range",
            item_ids: [1],
          } as unknown as { kind: "all" },
        },
      },
    });

    expect(invalid_scope_snapshot.extras).toEqual({
      kind: "translation",
      scope: { kind: "all" },
    });
    expect(missing_scope_snapshot.extras).toEqual({
      kind: "translation",
      scope: { kind: "all" },
    });
  });
});

describe("createTaskSnapshotStore", () => {
  it("拒绝旧 state revision 的任务快照回退", () => {
    const store = createTaskSnapshotStore();

    store.applySnapshot({
      run_revision: 3,
      task_type: "translation",
      status: "done",
      busy: false,
      request_in_flight_count: 0,
      progress: {
        line: 0,
        total_line: 0,
        processed_line: 0,
        error_line: 0,
        total_tokens: 0,
        total_output_tokens: 0,
        total_input_tokens: 0,
        time: 0,
        start_time: 0,
      },
      extras: { kind: "translation", scope: { kind: "all" } },
    });
    store.applySnapshot({
      run_revision: 2,
      task_type: "translation",
      status: "requested",
      busy: true,
      request_in_flight_count: 0,
      progress: {
        line: 0,
        total_line: 0,
        processed_line: 0,
        error_line: 0,
        total_tokens: 0,
        total_output_tokens: 0,
        total_input_tokens: 0,
        time: 0,
        start_time: 0,
      },
      extras: { kind: "translation", scope: { kind: "all" } },
    });

    expect(store.getSnapshot()).toMatchObject({
      run_revision: 3,
      status: "done",
      busy: false,
    });
  });
});
