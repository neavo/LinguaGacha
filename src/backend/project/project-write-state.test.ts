import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import {
  build_public_item_map,
  build_item_view_map,
  build_translation_extras_from_items,
  compute_project_prefilter_write,
  type ProjectWriteState,
} from "./project-write-state";

/** 构造完整公开条目，覆盖参数只表达当前场景需要的事实。 */
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
    skip_internal_filter: false,
    ...overrides,
  };
}

/** 同一文件的条目快照供预过滤与重复协调共同使用。 */
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
  it("内部预过滤与统计只读取业务字段，保留格式私有数据和上游姓名快照", () => {
    let private_reads = 0;
    const extra_field = {
      get nested() {
        private_reads += 1;
        return ["格式数据"];
      },
    };
    const original = create_item(1, { src: "hello", name_src: ["姓名", "格式槽"], extra_field });
    const state = create_state([original]);
    const result = compute_project_prefilter_write({
      state,
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });
    const progress = build_translation_extras_from_items({
      task_snapshot: {},
      items: build_item_view_map(build_public_item_map(state.items)),
    });
    expect(private_reads).toBe(0);
    expect(result.items["1"]!.extra_field).toBe(extra_field);
    expect(progress.total_line).toBe(1);
    const result_name = result.items["1"]!.name_src;
    if (Array.isArray(result_name)) result_name[0] = "编辑后";
    expect(original.name_src).toEqual(["姓名", "格式槽"]);
    expect(original.status).toBe("NONE");
  });
  it("按正文与可见姓名判断翻译候选，正文特殊规则不作用于姓名", () => {
    const result = compute_project_prefilter_write({
      state: create_state([
        create_item(1, { src: "「…………」", name_src: "眼鏡の美少女" }),
        create_item(2, { src: "", name_src: ["俊輔", "附加信息"] }),
        create_item(3, { src: "EV12", name_src: "EV12" }),
        create_item(4, { src: "……", name_src: "Alice" }),
        create_item(5, { src: "……", name_src: "image.png" }),
        create_item(6, { src: "……", name_src: ["", "俊輔"] }),
        create_item(7, { src: "こんにちは", name_src: "Alice" }),
      ]),
      source_language: "JA",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(Object.values(result.items).map((item) => item.status)).toEqual([
      "NONE",
      "NONE",
      "LANGUAGE_SKIPPED",
      "LANGUAGE_SKIPPED",
      "RULE_SKIPPED",
      "RULE_SKIPPED",
      "NONE",
    ]);
  });

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
          name_src: "姓名",
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
  });
});
