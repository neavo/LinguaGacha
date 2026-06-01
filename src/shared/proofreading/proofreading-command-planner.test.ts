import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import {
  create_clear_translations_plan,
  create_replace_all_plan,
  create_save_item_plan,
  create_set_translation_status_plan,
  type ProofreadingCommandSnapshot,
} from "./proofreading-command-planner";

/**
 * 构造当前场景的标准初始数据。
 */
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

/**
 * 构造当前场景的标准初始数据。
 */
function create_test_snapshot(
  items: ProjectItemPublicRecord[] = [
    create_test_item({
      item_id: 1,
      file_path: "script/a.txt",
      row_number: 1,
      src: "原文",
      dst: "",
      name_src: "Alice",
      extra_field: { keep: true },
      tag: "dialog",
      file_type: "TXT",
    }),
  ],
): ProofreadingCommandSnapshot {
  return {
    items,
    section_revisions: {
      items: 4,
      proofreading: 2,
    },
  };
}

describe("proofreading command planner", () => {
  it("保存译文只提交 item_id、dst 与 revision 锁", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot(),
      item_id: 1,
      next_dst: "译文",
    });

    expect(plan?.request_body).toEqual({
      item_id: 1,
      dst: "译文",
      expected_section_revisions: {
        items: 4,
        proofreading: 2,
      },
    });
  });

  it("正则全部替换只提交搜索命令并保留变更计数", () => {
    const plan = create_replace_all_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          file_path: "script/a.txt",
          row_number: 1,
          src: "原文",
          dst: "Name: Alice",
          status: "NONE",
        }),
      ]),
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
    });

    expect(plan?.request_body).toMatchObject({
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
      expected_section_revisions: {
        items: 4,
        proofreading: 2,
      },
    });
    expect(plan?.changed_item_ids).toEqual([1]);
  });

  it("清空译文只提交目标 item_ids 并保留状态和重试计数事实给后端", () => {
    const plan = create_clear_translations_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "已有译文",
          status: "PROCESSED",
          retry_count: 3,
        }),
      ]),
      item_ids: [1],
    });

    expect(plan).toEqual({
      changed_item_ids: [1],
      request_body: {
        item_ids: [1],
        expected_section_revisions: {
          items: 4,
          proofreading: 2,
        },
      },
    });
  });

  it("设置翻译状态会在状态相同但仍有重试计数时提交清理命令", () => {
    const plan = create_set_translation_status_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "已有译文",
          status: "PROCESSED",
          retry_count: 2,
        }),
      ]),
      item_ids: [1],
      status: "PROCESSED",
    });

    expect(plan).toEqual({
      changed_item_ids: [1],
      request_body: {
        item_ids: [1],
        status: "PROCESSED",
        expected_section_revisions: {
          items: 4,
          proofreading: 2,
        },
      },
    });
  });
});
