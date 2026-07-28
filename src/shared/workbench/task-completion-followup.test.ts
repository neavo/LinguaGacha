import { describe, expect, it } from "vitest";

import {
  should_open_analysis_glossary_import_followup,
  should_open_translation_export_followup,
} from "./task-completion-followup";

describe("task-completion-followup", () => {
  it.each([
    ["完整翻译从运行态完成时打开生成译文确认", "running", "done", true, "all", true],
    ["校对页局部重翻完成时不打开生成译文确认", "running", "done", true, "items", false],
    ["用户主动停止翻译后不打开生成译文确认", "stopping", "idle", true, "all", false],
    ["首屏已有完成态翻译快照不打开生成译文确认", "idle", "done", true, "all", false],
  ] as const)("%s", (_name, previous_status, next_status, has_result, scope_kind, expected) => {
    expect(
      should_open_translation_export_followup({
        previous_status,
        next_status,
        has_result,
        scope: scope_kind === "items" ? { kind: "items", item_ids: [2, 1] } : { kind: "all" },
      }),
    ).toBe(expected);
  });

  it.each([
    ["分析完成且存在候选术语时打开导入确认", 3, true],
    ["分析完成但没有候选术语时不打开导入确认", 0, false],
  ] as const)("%s", (_name, candidate_count, expected) => {
    expect(
      should_open_analysis_glossary_import_followup({
        previous_status: "running",
        next_status: "done",
        candidate_count,
      }),
    ).toBe(expected);
  });
});
