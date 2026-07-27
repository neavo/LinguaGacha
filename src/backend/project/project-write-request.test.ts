import { describe, expect, it } from "vitest";

import {
  normalize_analysis_checkpoint_writes,
  normalize_analysis_glossary_writes,
  normalize_analysis_progress_write,
  normalize_project_expected_section_revisions,
  normalize_translation_item_patches,
  require_project_expected_section_revisions,
} from "./project-write-request";

describe("project write request", () => {
  it("只接受非负整数 revision map", () => {
    expect(normalize_project_expected_section_revisions({ items: 2, analysis: 0 })).toEqual({
      items: 2,
      analysis: 0,
    });
    expect(() => normalize_project_expected_section_revisions({ items: "2" })).toThrow(
      "request.validation_failed",
    );
    expect(() => normalize_project_expected_section_revisions({ items: 1.5 })).toThrow(
      "request.validation_failed",
    );
  });

  it("需要 revision guard 的写入拒绝缺失 map", () => {
    expect(() => require_project_expected_section_revisions(undefined)).toThrow(
      "request.validation_failed",
    );
  });

  it("把任务 artifact 收窄为 typed Store 请求", () => {
    expect(
      normalize_translation_item_patches([
        { item_id: 1, dst: "译文", status: "PROCESSED", retry_count: 0 },
      ]),
    ).toEqual([
      {
        item_id: 1,
        patch: { dst: "译文", status: "PROCESSED", retry_count: 0 },
      },
    ]);
    expect(() => normalize_translation_item_patches([{ id: 1, dst: "旧契约" }])).toThrow(
      "runtime.internal_invariant",
    );
  });

  it("归一分析 checkpoint、术语和进度 artifact", () => {
    expect(
      normalize_analysis_checkpoint_writes([
        { item_id: 1, status: "PROCESSED", updated_at: "t" },
        { item_id: 0, status: "ERROR" },
      ]),
    ).toEqual([{ item_id: 1, status: "PROCESSED", updated_at: "t", error_count: 0 }]);
    expect(
      normalize_analysis_glossary_writes([
        { src: " A ", dst: " 甲 ", info: "", case_sensitive: true },
        { src: "A", dst: "甲", info: "", case_sensitive: true },
      ]),
    ).toEqual([{ src: "A", dst: "甲", info: "", case_sensitive: true }]);
    expect(normalize_analysis_progress_write({ total_line: 2, time: 1.5 })).toMatchObject({
      total_line: 2,
      time: 1.5,
      error_line: 0,
    });
  });
});
