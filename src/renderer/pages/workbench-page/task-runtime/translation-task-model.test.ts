import { describe, expect, it } from "vitest";

import {
  create_empty_translation_task_snapshot,
  resolve_translation_task_display_snapshot,
} from "./translation-task-model";

describe("translation-task-model", () => {
  it("终态当前快照不会被历史停止中快照覆盖", () => {
    const current_snapshot = {
      ...create_empty_translation_task_snapshot(),
      status: "idle",
      busy: false,
      line: 1,
      total_line: 2,
      total_output_tokens: 19,
      time: 6,
    };
    const stale_stopping_snapshot = {
      ...create_empty_translation_task_snapshot(),
      status: "stopping",
      busy: true,
      line: 1,
      total_line: 2,
      total_output_tokens: 19,
      start_time: 100,
    };

    const display_snapshot = resolve_translation_task_display_snapshot({
      current_snapshot,
      last_snapshot: stale_stopping_snapshot,
    });

    expect(display_snapshot).toMatchObject({
      status: "idle",
      busy: false,
      line: 1,
      total_line: 2,
    });
  });
});
