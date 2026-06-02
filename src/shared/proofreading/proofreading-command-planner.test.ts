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
  it("保存译文只提交 item_id、变化字段与 revision 锁", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot(),
      item_id: 1,
      next_dst: "译文",
      next_name_dst: "",
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

  it("保存姓名译文时只提交第 0 槽姓名字段", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "正文译文",
          name_dst: ["旧译名", "保留译名"],
        }),
      ]),
      item_id: 1,
      next_dst: "正文译文",
      next_name_dst: "新译名",
    });

    expect(plan?.request_body).toEqual({
      item_id: 1,
      name_dst: "新译名",
      expected_section_revisions: {
        items: 4,
        proofreading: 2,
      },
    });
  });

  it("姓名数组第 0 槽为空时仍只比较第 0 槽", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "正文译文",
          name_src: ["", "Bob"],
          name_dst: ["", "旧译名"],
        }),
      ]),
      item_id: 1,
      next_dst: "正文译文",
      next_name_dst: "新译名",
    });

    expect(plan?.request_body).toEqual({
      item_id: 1,
      name_dst: "新译名",
      expected_section_revisions: {
        items: 4,
        proofreading: 2,
      },
    });
  });

  it("正文和姓名译文同时变化时放入同一保存命令", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "旧正文",
          name_dst: "旧译名",
        }),
      ]),
      item_id: 1,
      next_dst: "新正文",
      next_name_dst: "新译名",
    });

    expect(plan?.request_body).toMatchObject({
      item_id: 1,
      dst: "新正文",
      name_dst: "新译名",
    });
  });

  it("正文和姓名译文都未变化时不提交保存命令", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "正文译文",
          name_dst: ["译名", "保留译名"],
        }),
      ]),
      item_id: 1,
      next_dst: "正文译文",
      next_name_dst: "译名",
    });

    expect(plan).toBeNull();
  });

  it("清空第 0 槽姓名译文时提交空字符串", () => {
    const plan = create_save_item_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "旧正文",
          name_src: "Alice",
          name_dst: "旧译名",
        }),
      ]),
      item_id: 1,
      next_dst: "旧正文",
      next_name_dst: "",
    });

    expect(plan?.request_body).toEqual({
      item_id: 1,
      name_dst: "",
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

  it("全部替换会把第 0 槽姓名译文变化纳入变更计数", () => {
    const plan = create_replace_all_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "正文译文",
          name_dst: ["Name: Alice", "保留译名"],
          status: "PROCESSED",
        }),
      ]),
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
    });

    expect(plan?.changed_item_ids).toEqual([1]);
    expect(plan?.request_body).toMatchObject({
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
    });
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

  it("正文译文为空且姓名译文第 0 槽为空时不提交清空命令", () => {
    const plan = create_clear_translations_plan({
      snapshot: create_test_snapshot([
        create_test_item({
          item_id: 1,
          dst: "",
          name_dst: ["", "保留译名"],
          status: "PROCESSED",
        }),
      ]),
      item_ids: [1],
    });

    expect(plan).toBeNull();
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
