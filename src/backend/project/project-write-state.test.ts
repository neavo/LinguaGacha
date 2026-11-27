import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import { compute_project_prefilter_items, type ProjectWriteState } from "./project-write-state";

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
    status: "NONE",
    ...overrides,
  };
}

/** 项目条目快照供预过滤与重复协调共同使用。 */
function create_state(items: ProjectItemPublicRecord[]): ProjectWriteState {
  return {
    files: {
      "script.txt": {
        rel_path: "script.txt",
        file_type: "TXT",
        sort_index: 0,
      },
      "other.txt": { rel_path: "other.txt", file_type: "TXT", sort_index: 1 },
    },
    items: Object.fromEntries(items.map((item) => [String(item.item_id), item])),
  };
}

describe("compute_project_prefilter_items", () => {
  it("预过滤复用格式私有数据，条目状态修改与上游隔离", () => {
    let private_reads = 0;
    const extra_field = {
      get nested() {
        private_reads += 1;
        return ["格式数据"];
      },
    };
    const original = create_item(1, {
      src: "hello",
      extra_field,
    });
    const state = create_state([original]);
    const result = compute_project_prefilter_items({
      state,
      source_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });
    expect(private_reads).toBe(0);
    expect(result["1"]!.extra_field).toBe(extra_field);
    result["1"]!.status = "PROCESSED";
    expect(original.status).toBe("NONE");
  });
  it("稀疏身份与输入顺序不影响重复代表项，输出仍按身份索引", () => {
    const later = create_item(9001, { src: "同文" });
    const first = create_item(7, { src: "同文", status: "DUPLICATED" });
    const result = compute_project_prefilter_items({
      state: { files: create_state([]).files, items: { later, first } },
      source_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });
    expect(Object.keys(result)).toEqual(["7", "9001"]);
    expect(result["7"]!.status).toBe("NONE");
    expect(result["9001"]!.status).toBe("DUPLICATED");
    expect([later.status, first.status]).toEqual(["NONE", "DUPLICATED"]);
  });
  it("按正文与可见姓名判断翻译候选，正文特殊规则不作用于姓名", () => {
    const result = compute_project_prefilter_items({
      state: create_state([
        create_item(1, { src: "「…………」", name_src: "眼鏡の美少女" }),
        create_item(2, { src: "", name_src: "俊輔" }),
        create_item(3, { src: "EV12", name_src: "EV12" }),
        create_item(4, { src: "……", name_src: "Alice" }),
        create_item(5, { src: "……", name_src: "image.png" }),
        create_item(6, { src: "……", name_src: "" }),
        create_item(7, { src: "こんにちは", name_src: "Alice" }),
      ]),
      source_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(Object.values(result).map((item) => item.status)).toEqual([
      "NONE",
      "NONE",
      "LANGUAGE_SKIPPED",
      "LANGUAGE_SKIPPED",
      "RULE_SKIPPED",
      "RULE_SKIPPED",
      "NONE",
    ]);
  });

  it("按规则和源语言生成跳过状态", () => {
    const result = compute_project_prefilter_items({
      state: create_state([
        create_item(1, { src: "hello" }),
        create_item(2, { src: "こんにちは" }),
        create_item(3, { src: "   " }),
      ]),
      source_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result["1"]?.status).toBe("LANGUAGE_SKIPPED");
    expect(result["2"]?.status).toBe("NONE");
    expect(result["3"]?.status).toBe("RULE_SKIPPED");
  });

  it("已完成条目保留译文和状态", () => {
    const result = compute_project_prefilter_items({
      state: create_state([
        create_item(1, {
          src: "",
          dst: "保留",
          status: "PROCESSED",
        }),
      ]),
      source_language: "JA",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result["1"]).toMatchObject({
      dst: "保留",
      status: "PROCESSED",
    });
  });

  it("保留格式解析器产生的规则跳过状态", () => {
    const result = compute_project_prefilter_items({
      state: create_state([
        create_item(1, {
          src: "格式内部字段",
          file_type: "WOLFRPG",
          status: "RULE_SKIPPED",
          name_src: "姓名",
        }),
      ]),
      source_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result["1"]?.status).toBe("RULE_SKIPPED");
  });

  it("启用同文件重复过滤时只保留首个可翻译条目", () => {
    const result = compute_project_prefilter_items({
      state: create_state([create_item(1, { src: "同文" }), create_item(2, { src: "同文" })]),
      source_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(result["1"]?.status).toBe("NONE");
    expect(result["2"]?.status).toBe("DUPLICATED");
  });

  it("不同角色分别保留可翻译条目", () => {
    const result = compute_project_prefilter_items({
      state: create_state([
        create_item(1, { src: "同文", name_src: "甲" }),
        create_item(2, { src: "同文", name_src: "乙" }),
        create_item(3, { src: "同文", name_src: "甲" }),
      ]),
      source_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(Object.values(result).map((item) => item.status)).toEqual([
      "NONE",
      "NONE",
      "DUPLICATED",
    ]);
  });

  it("关闭重复过滤时旧 DUPLICATED 会回到可处理状态", () => {
    const result = compute_project_prefilter_items({
      state: create_state([
        create_item(1, { src: "同文" }),
        create_item(2, { src: "同文", status: "DUPLICATED" }),
      ]),
      source_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    });

    expect(result["2"]?.status).toBe("NONE");
  });
});
