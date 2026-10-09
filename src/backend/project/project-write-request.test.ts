import { describe, expect, it } from "vitest";

import {
  normalize_project_expected_section_revisions,
  normalize_translation_item_patches,
  require_project_expected_section_revisions,
} from "./project-write-request";

describe("project write request", () => {
  it("只接受非负整数 revision map", () => {
    expect(normalize_project_expected_section_revisions({ items: 2 })).toEqual({
      items: 2,
    });
    expect(() => normalize_project_expected_section_revisions({ items: "2" })).toThrow(
      expect.objectContaining({ code: "request.validation_failed" }),
    );
    expect(() => normalize_project_expected_section_revisions({ items: 1.5 })).toThrow(
      expect.objectContaining({ code: "request.validation_failed" }),
    );
  });

  it.each(["8", "1.8", 1.8, -1, NaN, Infinity, null])(
    "预期修订 %s 在冲突检查前严格拒绝",
    (revision) => {
      expect(() => normalize_project_expected_section_revisions({ items: revision })).toThrow(
        expect.objectContaining({ code: "request.validation_failed" }),
      );
    },
  );

  it("需要 revision guard 的写入拒绝缺失 map", () => {
    expect(() => require_project_expected_section_revisions(undefined)).toThrow(
      expect.objectContaining({ code: "request.validation_failed" }),
    );
  });

  it("把任务 artifact 收窄为 typed Store 请求", () => {
    expect(
      normalize_translation_item_patches([{ item_id: 1, dst: "译文", status: "PROCESSED" }]),
    ).toEqual([
      {
        item_id: 1,
        patch: { dst: "译文", status: "PROCESSED" },
      },
    ]);
    expect(() => normalize_translation_item_patches([{ id: 1, dst: "旧契约" }])).toThrow(
      expect.objectContaining({ code: "runtime.internal_invariant" }),
    );
  });
});
