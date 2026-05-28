import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import {
  compute_project_prefilter_mutation,
  type ProjectMutationState,
} from "./project-mutation-state";

// 测试 item 保持完整公开 DTO 形状，避免用半截对象绕过真实归一化边界。
/**
 * 构造当前测试场景的标准数据。
 */
function create_test_item(
  key: string,
  overrides: Partial<ProjectItemPublicRecord>,
): ProjectItemPublicRecord {
  return {
    item_id: Number(overrides.item_id ?? key),
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

// 每个场景只覆盖需要变动的 item 字段，其余项目事实由后端默认镜像补齐。
/**
 * 构造当前测试场景的标准数据。
 */
function create_state(
  items: Record<string, Partial<ProjectItemPublicRecord>>,
): ProjectMutationState {
  return {
    files: {
      "script.txt": {
        rel_path: "script.txt",
        file_type: "TXT",
      },
      "data.json": {
        rel_path: "data.json",
        file_type: "KVJSON",
      },
    },
    items: Object.fromEntries(
      Object.entries(items).map(([key, item]) => [key, create_test_item(key, item)]),
    ),
  };
}

describe("compute_project_prefilter_mutation", () => {
  it("按规则和输入语言生成跳过状态，并把项目设置镜像写入输出", () => {
    const output = compute_project_prefilter_mutation({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "script.txt",
          row_number: 1,
          src: "mapdata/title.png",
          status: "NONE",
        },
        "2": {
          item_id: 2,
          file_path: "script.txt",
          row_number: 2,
          src: "plain english line",
          status: "NONE",
        },
        "3": {
          item_id: 3,
          file_path: "script.txt",
          row_number: 3,
          src: "こんにちは",
          status: "LANGUAGE_SKIPPED",
        },
      }),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(output.items["1"].status).toBe("RULE_SKIPPED");
    expect(output.items["2"].status).toBe("LANGUAGE_SKIPPED");
    expect(output.items["3"].status).toBe("NONE");
    expect(output.project_settings).toEqual({
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });
    expect(output.prefilter_config).toEqual({
      source_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });
  });

  it("启用 MTool 优化器时只在后端派生 KVJSON 重复短句跳过", () => {
    const output = compute_project_prefilter_mutation({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "data.json",
          row_number: 1,
          src: "短句 A\n短句 B",
          status: "NONE",
        },
        "2": {
          item_id: 2,
          file_path: "data.json",
          row_number: 2,
          src: "短句 A",
          status: "NONE",
        },
      }),
      source_language: "ALL",
      target_language: "ZH",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });

    expect(output.items["1"].status).toBe("NONE");
    expect(output.items["2"].status).toBe("RULE_SKIPPED");
    expect(output.stats.mtool_skipped).toBe(1);
    expect(output.prefilter_config).toEqual({
      source_language: "ALL",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });
  });

  it("强制翻译条目绕过规则和语言预过滤并保留运行态字段", () => {
    const output = compute_project_prefilter_mutation({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "script.txt",
          row_number: 1,
          src: "voice.ogg",
          status: "NONE",
          skip_internal_filter: true,
        },
        "2": {
          item_id: 2,
          file_path: "script.txt",
          row_number: 2,
          src: "plain english line",
          status: "NONE",
          skip_internal_filter: true,
        },
      }),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(output.items["1"].status).toBe("NONE");
    expect(output.items["2"].status).toBe("NONE");
    expect(output.items["1"].skip_internal_filter).toBe(true);
    expect(output.stats.rule_skipped).toBe(0);
    expect(output.stats.language_skipped).toBe(0);
  });

  it("按同一文件内完全一致的原文标记重复项", () => {
    const output = compute_project_prefilter_mutation({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "script.txt",
          row_number: 1,
          src: "同一句",
          status: "NONE",
        },
        "2": {
          item_id: 2,
          file_path: "script.txt",
          row_number: 2,
          src: "同一句",
          status: "NONE",
        },
        "3": {
          item_id: 3,
          file_path: "data.json",
          row_number: 1,
          src: "同一句",
          status: "NONE",
        },
        "4": {
          item_id: 4,
          file_path: "script.txt",
          row_number: 4,
          src: "plain english line",
          status: "DUPLICATED",
        },
      }),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(output.items["1"].status).toBe("NONE");
    expect(output.items["2"].status).toBe("DUPLICATED");
    expect(output.items["3"].status).toBe("NONE");
    expect(output.items["4"].status).toBe("LANGUAGE_SKIPPED");
    expect(output.stats.duplicated).toBe(1);
  });

  it("重跑预过滤时已完成译文会继续作为重复项首条", () => {
    const output = compute_project_prefilter_mutation({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "script.txt",
          row_number: 1,
          src: "こんにちは",
          dst: "你好",
          status: "PROCESSED",
        },
        "2": {
          item_id: 2,
          file_path: "script.txt",
          row_number: 2,
          src: "こんにちは",
          status: "DUPLICATED",
        },
        "3": {
          item_id: 3,
          file_path: "other.txt",
          row_number: 1,
          src: "こんにちは",
          status: "NONE",
        },
      }),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(output.items["1"].status).toBe("PROCESSED");
    expect(output.items["2"].status).toBe("DUPLICATED");
    expect(output.items["3"].status).toBe("NONE");
    expect(output.stats.duplicated).toBe(1);
  });

  it("关闭跳过重复原文时旧 DUPLICATED 会回到 NONE 并重新参与过滤", () => {
    const output = compute_project_prefilter_mutation({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "script.txt",
          row_number: 1,
          src: "こんにちは",
          status: "DUPLICATED",
        },
      }),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(output.items["1"].status).toBe("NONE");
    expect(output.prefilter_config.skip_duplicate_source_text_enable).toBe(false);
  });
});
