import { describe, expect, it } from "vitest";

import { run_worker_task } from "./worker-task";

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

  it("执行名称字段提取 task 并按筛选条件返回行和计数", async () => {
    const result = await run_worker_task({
      type: "name_field_extraction",
      input: {
        items: [
          { name: "Alice", name_src: "Alice", name_dst: "艾丽丝" },
          { name: "Bob", name_src: "Bob", name_dst: "" },
        ],
        glossary_entries: [],
        filter: { keyword: "Alice", scope: "src", is_regex: false },
        sort: { field: null, direction: null },
      },
    });

    expect(result.counts.total).toBeGreaterThanOrEqual(result.rows.length);
    expect(result.invalid_regex_message).toBeNull();
    expect(result.rows.every((row) => row.src.includes("Alice"))).toBe(true);
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

  it("执行校对 hydration task 并只返回可序列化评估分片", async () => {
    const result = await run_worker_task({
      type: "proofreading_hydration",
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
