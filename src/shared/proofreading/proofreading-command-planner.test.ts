import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import {
  create_clear_translations_plan,
  create_replace_all_plan,
  create_apply_item_changes_plan,
  type ProofreadingCommandSnapshot,
} from "./proofreading-command-planner";

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_test_snapshot(items: ProjectItemPublicRecord[]): ProofreadingCommandSnapshot {
  return { items, section_revisions: { items: 4, proofreading: 2 } };
}

describe("proofreading command planner", () => {
  it("批量译文、译名和状态变化统一提交 changes 与 revision 锁", () => {
    const plan = create_apply_item_changes_plan({
      snapshot: create_test_snapshot([
        create_test_item({ item_id: 1, dst: "旧正文", name_dst: "旧译名" }),
        create_test_item({ item_id: 2, status: "PROCESSED", retry_count: 2 }),
      ]),
      changes: [
        { item_id: 1, dst: "新正文", name_dst: "新译名" },
        { item_id: 2, status: "PROCESSED" },
      ],
    });

    expect(plan).toEqual({
      changed_item_ids: [1, 2],
      request_body: {
        changes: [
          { item_id: 1, dst: "新正文", name_dst: "新译名" },
          { item_id: 2, status: "PROCESSED" },
        ],
        expected_section_revisions: { items: 4, proofreading: 2 },
      },
    });
  });

  it("姓名数组只比较第 0 槽，并在无最终变化时省略命令", () => {
    const snapshot = create_test_snapshot([
      create_test_item({ item_id: 1, dst: "正文", name_dst: ["译名", "保留"] }),
    ]);
    expect(
      create_apply_item_changes_plan({
        snapshot,
        changes: [{ item_id: 1, dst: "正文", name_dst: "译名" }],
      }),
    ).toBeNull();
    expect(
      create_apply_item_changes_plan({
        snapshot,
        changes: [{ item_id: 1, name_dst: "新译名" }],
      })?.request_body.changes,
    ).toEqual([{ item_id: 1, name_dst: "新译名" }]);
  });

  it("显式状态在必要时覆盖 dst 自动状态并清理 retry", () => {
    const plan = create_apply_item_changes_plan({
      snapshot: create_test_snapshot([
        create_test_item({ item_id: 1, dst: "旧", status: "EXCLUDED", retry_count: 0 }),
      ]),
      changes: [{ item_id: 1, dst: "新", status: "EXCLUDED" }],
    });
    expect(plan?.request_body.changes).toEqual([{ item_id: 1, dst: "新", status: "EXCLUDED" }]);

    expect(
      create_apply_item_changes_plan({
        snapshot: create_test_snapshot([
          create_test_item({ item_id: 1, status: "PROCESSED", retry_count: 0 }),
        ]),
        changes: [{ item_id: 1, status: "PROCESSED" }],
      }),
    ).toBeNull();
  });

  it("正则全部替换仍只提交后端搜索命令", () => {
    const plan = create_replace_all_plan({
      snapshot: create_test_snapshot([create_test_item({ item_id: 1, dst: "Name: Alice" })]),
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
    });
    expect(plan).toMatchObject({
      changed_item_ids: [1],
      request_body: {
        item_ids: [1],
        search_text: "Name: (.+)",
        replace_text: "$1",
        is_regex: true,
      },
    });
  });

  it.each([false, true])("清空译文显式打包状态重置意图：%s", (reset_status) => {
    expect(
      create_clear_translations_plan({
        section_revisions: { items: 4, proofreading: 2 },
        item_ids: [1],
        reset_status,
      }),
    ).toEqual({
      changed_item_ids: [1],
      request_body: {
        item_ids: [1],
        reset_status,
        expected_section_revisions: { items: 4, proofreading: 2 },
      },
    });
  });
});
