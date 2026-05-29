import { describe, expect, it } from "vitest";

import {
  resolve_translation_completion_scenario,
  should_open_analysis_glossary_import_followup,
  should_open_translation_export_followup,
} from "./task-completion-followup";

describe("task-completion-followup", () => {
  it("完整翻译从运行态完成时打开生成译文确认", () => {
    expect(
      should_open_translation_export_followup({
        previous_status: "running",
        next_status: "done",
        has_result: true,
        scope: { kind: "all" },
      }),
    ).toBe(true);
  });

  it("校对页局部重翻完成时不打开生成译文确认", () => {
    expect(resolve_translation_completion_scenario({ kind: "items", item_ids: [2, 1] })).toBe(
      "proofreading-retranslation",
    );
    expect(
      should_open_translation_export_followup({
        previous_status: "running",
        next_status: "done",
        has_result: true,
        scope: { kind: "items", item_ids: [2, 1] },
      }),
    ).toBe(false);
  });

  it("用户主动停止翻译后不打开生成译文确认", () => {
    expect(
      should_open_translation_export_followup({
        previous_status: "stopping",
        next_status: "idle",
        has_result: true,
        scope: { kind: "all" },
      }),
    ).toBe(false);
  });

  it("首屏已有完成态翻译快照不打开生成译文确认", () => {
    expect(
      should_open_translation_export_followup({
        previous_status: "idle",
        next_status: "done",
        has_result: true,
        scope: { kind: "all" },
      }),
    ).toBe(false);
  });

  it("分析完成且存在候选术语时打开导入确认", () => {
    expect(
      should_open_analysis_glossary_import_followup({
        previous_status: "running",
        next_status: "done",
        candidate_count: 3,
      }),
    ).toBe(true);
  });

  it("分析完成但没有候选术语时不打开导入确认", () => {
    expect(
      should_open_analysis_glossary_import_followup({
        previous_status: "running",
        next_status: "done",
        candidate_count: 0,
      }),
    ).toBe(false);
  });
});
