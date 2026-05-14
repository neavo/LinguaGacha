import { describe, expect, it } from "vitest";

import { normalize_task_snapshot } from "./task-runtime-store";

describe("normalize_task_snapshot", () => {
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
});
