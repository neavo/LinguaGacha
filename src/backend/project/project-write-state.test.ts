import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import { compute_project_prefilter_write, type ProjectWriteState } from "./project-write-state";

function create_item(
  item_id: number,
  overrides: Partial<ProjectItemPublicRecord> = {},
): ProjectItemPublicRecord {
  return {
    item_id,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: item_id - 1,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_state(items: ProjectItemPublicRecord[]): ProjectWriteState {
  return {
    files: {
      "script.txt": {
        rel_path: "script.txt",
        file_type: "TXT",
      },
    },
    items: Object.fromEntries(items.map((item) => [String(item.item_id), item])),
  };
}

describe("compute_project_prefilter_write", () => {
  it("按规则和源语言生成跳过状态并返回项目设置镜像", () => {
    const result = compute_project_prefilter_write({
      state: create_state([
        create_item(1, { src: "hello" }),
        create_item(2, { src: "こんにちは" }),
        create_item(3, { src: "   " }),
      ]),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result.items["1"]?.status).toBe("LANGUAGE_SKIPPED");
    expect(result.items["2"]?.status).toBe("NONE");
    expect(result.items["3"]?.status).toBe("RULE_SKIPPED");
    expect(result.project_settings).toEqual({
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });
    expect(result.stats).toMatchObject({ rule_skipped: 1, language_skipped: 1 });
  });

  it("强制翻译条目绕过规则和语言过滤并保留运行态字段", () => {
    const result = compute_project_prefilter_write({
      state: create_state([
        create_item(1, {
          src: "",
          dst: "保留",
          status: "PROCESSED",
          retry_count: 2,
          skip_internal_filter: true,
        }),
      ]),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result.items["1"]).toMatchObject({
      dst: "保留",
      status: "PROCESSED",
      retry_count: 2,
      skip_internal_filter: true,
    });
  });

  it("保留格式解析器产生的规则跳过状态", () => {
    const result = compute_project_prefilter_write({
      state: create_state([
        create_item(1, {
          src: "格式内部字段",
          file_type: "WOLFXLSX",
          status: "RULE_SKIPPED",
        }),
      ]),
      source_language: "ZH",
      target_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result.items["1"]?.status).toBe("RULE_SKIPPED");
    expect(result.stats.rule_skipped).toBe(1);
  });

  it("启用同文件重复过滤时只保留首个可翻译条目", () => {
    const result = compute_project_prefilter_write({
      state: create_state([create_item(1, { src: "同文" }), create_item(2, { src: "同文" })]),
      source_language: "ZH",
      target_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(result.items["1"]?.status).toBe("NONE");
    expect(result.items["2"]?.status).toBe("DUPLICATED");
    expect(result.stats.duplicated).toBe(1);
  });

  it("角色或文本规则不同时分别保留可翻译条目", () => {
    const result = compute_project_prefilter_write({
      state: create_state([
        create_item(1, { src: "同文", name_src: "甲", text_type: "KAG" }),
        create_item(2, { src: "同文", name_src: "乙", text_type: "KAG" }),
        create_item(3, { src: "同文", name_src: "甲", text_type: "RENPY" }),
      ]),
      source_language: "ZH",
      target_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(Object.values(result.items).map((item) => item.status)).toEqual([
      "NONE",
      "NONE",
      "NONE",
    ]);
    expect(result.stats.duplicated).toBe(0);
  });

  it("关闭重复过滤时旧 DUPLICATED 会回到可处理状态", () => {
    const result = compute_project_prefilter_write({
      state: create_state([
        create_item(1, { src: "同文" }),
        create_item(2, { src: "同文", status: "DUPLICATED" }),
      ]),
      source_language: "ZH",
      target_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result.items["2"]?.status).toBe("NONE");
    expect(result.analysis.status_summary).toMatchObject({
      total_line: 2,
      processed_line: 0,
      error_line: 0,
    });
  });
});
