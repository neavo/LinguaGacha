import { describe, expect, it } from "vitest";

import { run_worker_task } from "./worker-task";

function read_text_signature(result: Record<string, unknown>): string {
  const snapshot = result.current_snapshot;
  if (typeof snapshot !== "object" || snapshot === null) {
    throw new Error("缺少质量统计快照。");
  }
  const text_signature = (snapshot as { text_signature?: unknown }).text_signature;
  if (typeof text_signature !== "string") {
    throw new Error("缺少文本签名。");
  }
  return text_signature;
}

describe("run_worker_task", () => {
  it("执行质量统计 task 并返回匹配计数快照", async () => {
    const result = await run_worker_task({
      type: "quality_statistics",
      input: {
        rule_key: "glossary",
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
        items: [
          { src: "HP +10", dst: "生命值 +10" },
          { src: "MP +5", dst: "魔力 +5" },
        ],
      },
    });

    expect(result).toMatchObject({
      phase: "current",
      completed_entry_ids: ["hp"],
      matched_count_by_entry_id: { hp: 1 },
      last_error: null,
    });
  });

  it("质量统计 task 会统计第 0 槽姓名字段并按 item 去重", async () => {
    const result = await run_worker_task({
      type: "quality_statistics",
      input: {
        rule_key: "glossary",
        entries: [{ entry_id: "alice", src: "Alice", dst: "艾丽丝" }],
        items: [
          { src: "Alice 登场", dst: "", name_src: "Alice", name_dst: "" },
          { src: "普通正文", dst: "", name_src: ["", "Alice"], name_dst: "" },
        ],
      },
    });

    expect(result).toMatchObject({
      matched_count_by_entry_id: { alice: 1 },
    });
  });

  it("质量统计快照签名会响应姓名字段变化", async () => {
    const create_result = async (name_src: string) => {
      return await run_worker_task({
        type: "quality_statistics",
        input: {
          rule_key: "glossary",
          entries: [{ entry_id: "alice", src: "Alice", dst: "艾丽丝" }],
          items: [{ src: "普通正文", dst: "", name_src, name_dst: "" }],
        },
      });
    };

    const first_result = await create_result("Alice");
    const second_result = await create_result("Bob");

    expect(read_text_signature(first_result)).not.toBe(read_text_signature(second_result));
  });

  it("执行繁简转换 task 并返回转换后的条目", async () => {
    const result = await run_worker_task({
      type: "ts_conversion",
      input: {
        items: [
          {
            item_id: 1,
            src: "测试",
            dst: "鼠标",
            name_src: "装备",
            name_dst: "鼠标",
            text_type: "NONE",
          },
        ],
        direction: "s2t",
        convert_name: true,
        preserve_text: false,
        text_preserve_mode: "off",
        custom_rules: [],
        preset_rules_by_text_type: {},
      },
    });

    expect(result[0]).toMatchObject({
      item_id: 1,
      dst: "鼠標",
      name_dst: "鼠標",
    });
  });

  it("执行校对 sync task 并只返回可序列化评估分片", async () => {
    const result = await run_worker_task({
      type: "proofreading_sync",
      input: {
        projectId: "E:/Project/demo.lg",
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
        total_item_count: 1,
        upsertItems: [
          {
            item_id: 1,
            file_path: "script.txt",
            file_order: 0,
            row_number: 1,
            src: "HP",
            dst: "HP",
            name_src: "Alice",
            name_dst: "艾丽丝",
            status: "PROCESSED",
            text_type: "NONE",
            retry_count: 0,
          },
        ],
        quality: {
          glossary: { entries: [], enabled: true, mode: "custom", revision: 0 },
          pre_replacement: { entries: [], enabled: true, mode: "custom", revision: 0 },
          post_replacement: { entries: [], enabled: true, mode: "custom", revision: 0 },
          text_preserve: { entries: [], enabled: true, mode: "smart", revision: 0 },
        },
        sourceLanguage: "JA",
        targetLanguage: "ZH",
      },
    });

    expect(result).toMatchObject({
      projectId: "E:/Project/demo.lg",
      total_item_count: 1,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });
    expect(result.rawItems).toHaveLength(1);
    expect(result.evaluatedItems).toHaveLength(1);
  });
});
