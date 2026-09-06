import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";

import {
  build_section_revisions_from_meta,
  get_section_revision,
  ProjectDataReader,
} from "./project-data-reader";

type ProjectDataDatabase = Pick<
  ProjectDatabase,
  | "get_all_meta"
  | "get_all_items"
  | "get_all_asset_records"
  | "get_asset_count"
  | "get_item_count"
  | "get_items_by_ids"
  | "get_rules"
  | "get_rule_text"
>;

function create_database_stub(overrides: Partial<ProjectDataDatabase> = {}): ProjectDatabase {
  return {
    get_all_meta: () => ({}),
    get_all_items: () => [],
    get_all_asset_records: () => [],
    get_asset_count: () => 0,
    get_item_count: () => 0,
    get_items_by_ids: () => [],
    get_rules: () => [],
    get_rule_text: () => "",
    get_analysis_candidate_aggregates: () => [],
    ...overrides,
  } as unknown as ProjectDatabase;
}

describe("project section revision", () => {
  it("从 meta 归一项目数据 section revision 并过滤坏值", () => {
    const meta = {
      "project_runtime_revision.files": -1,
      "project_runtime_revision.items": "9.7",

      "proofreading_revision.proofreading": "6.2",
      "quality_rule_revision.glossary": 2,
      "quality_rule_revision.text_preserve": "5.9",
      "quality_rule_revision.pre_replacement": "坏值",
      "quality_rule_revision.post_replacement": 3,
      "quality_prompt_revision.translation": "8.8",
    };

    expect(get_section_revision(meta, "files")).toBe(0);
    expect(get_section_revision(meta, "items")).toBe(9);
    expect(get_section_revision(meta, "proofreading")).toBe(6);
    expect(get_section_revision(meta, "quality:glossary")).toBe(2);
    expect(get_section_revision(meta, "quality")).toBe(5);
    expect(get_section_revision(meta, "prompts:translation")).toBe(8);
    expect(get_section_revision(meta, "prompts")).toBe(8);
    expect(get_section_revision(meta, "unknown")).toBe(0);
  });

  it("构建完整 section revision 快照", () => {
    expect(
      build_section_revisions_from_meta({
        "project_runtime_revision.files": 3,
        "project_runtime_revision.items": 9,

        "proofreading_revision.proofreading": 6,
        "quality_rule_revision.glossary": 2,
        "quality_prompt_revision.translation": 8,
      }),
    ).toEqual({
      project: 0,
      files: 3,
      items: 9,
      quality: 2,
      prompts: 8,

      proofreading: 6,
    });
  });
});

describe("ProjectDataReader", () => {
  it("读取 quality/prompts 时不预热 items 快照", () => {
    const get_all_items = vi.fn(() => {
      throw new Error("不应读取 items");
    });
    const get_all_meta = vi.fn(() => ({}));
    const get_rules = vi.fn(() => []);
    const get_rule_text = vi.fn(() => "");
    const service = new ProjectDataReader(
      create_database_stub({ get_all_items, get_all_meta, get_rules, get_rule_text }),
    );

    service.build_section_payloads({
      projectState: { loaded: true, projectPath: "E:/demo/demo.lg" },
      sections: ["quality", "prompts"],
    });

    expect(get_all_meta).toHaveBeenCalled();
    expect(get_rules).toHaveBeenCalled();
    expect(get_rule_text).toHaveBeenCalled();
    expect(get_all_items).not.toHaveBeenCalled();
  });

  it("prompts section 使用顶层 enabled 表达自定义提示词启用态", () => {
    const service = new ProjectDataReader(
      create_database_stub({
        get_all_meta: () => ({
          translation_prompt_enable: true,

          "quality_prompt_revision.translation": 4,
        }),
        get_rule_text: (_project_path, rule_type) =>
          rule_type === "translation_prompt" ? "翻译提示词" : "分析提示词",
      }),
    );

    const payload = service.build_section_payloads({
      projectState: { loaded: true, projectPath: "E:/demo/demo.lg" },
      sections: ["prompts"],
    });
    const sections = payload["sections"] as Record<string, unknown>;
    const prompts = sections["prompts"] as Record<string, Record<string, unknown>>;

    expect(prompts["translation"]).toEqual({
      revision: 4,
      enabled: true,
      text: "翻译提示词",
    });

    expect(prompts["translation"]).not.toHaveProperty("meta");
    expect(prompts["translation"]).not.toHaveProperty("task_type");
  });

  it("质量切片缺少 meta 时使用质量规则领域默认值", () => {
    const service = new ProjectDataReader(
      create_database_stub({
        get_rules: (_project_path, rule_type) =>
          rule_type === "glossary" ? [{ entry_id: "hp", src: "HP", dst: "生命值" }] : [],
      }),
    );

    const payload = service.build_section_payloads({
      projectState: { loaded: true, projectPath: "E:/demo/demo.lg" },
      sections: ["quality"],
    });
    const sections = payload["sections"] as Record<string, unknown>;
    const quality = sections["quality"] as Record<string, Record<string, unknown>>;

    expect(quality["glossary"]).toMatchObject({
      enabled: true,
      entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
    });
    expect(quality["text_preserve"]).toMatchObject({ enabled: false, mode: "smart" });
    expect(quality["pre_replacement"]?.enabled).toBe(false);
    expect(quality["post_replacement"]?.enabled).toBe(false);
  });

  it("manifest 计数使用聚合读取，不扫描完整 item payload", () => {
    const get_all_items = vi.fn(() => {
      throw new Error("不应读取 items");
    });
    const get_asset_count = vi.fn(() => 2);
    const get_item_count = vi.fn(() => 5);
    const service = new ProjectDataReader(
      create_database_stub({ get_all_items, get_asset_count, get_item_count }),
    );

    const manifest = service.build_manifest({ loaded: true, projectPath: "E:/demo/demo.lg" });

    expect(manifest["counts"]).toEqual({ files: 2, items: 5 });
    expect(get_asset_count).toHaveBeenCalledWith("E:/demo/demo.lg");
    expect(get_item_count).toHaveBeenCalledWith("E:/demo/demo.lg");
    expect(get_all_items).not.toHaveBeenCalled();
  });

  it("按 id 读取 item 时只返回后端规范行 DTO", () => {
    const get_items_by_ids = vi.fn(() => [
      {
        id: 2,
        file_path: "chapter02.txt",
        row: 1,
        src: "foo",
        dst: "bar",
        name_src: "Alice",
        name_dst: null,
        extra_field: { note: "keep" },
        tag: "line",
        file_type: "TXT",
        text_type: "NONE",
        status: "NONE",
        retry_count: 0,
        skip_internal_filter: false,
      },
    ]);
    const service = new ProjectDataReader(
      create_database_stub({
        get_all_meta: () => ({
          "project_runtime_revision.items": 7,
          "project_runtime_revision.files": 3,
          "proofreading_revision.proofreading": 5,
        }),
        get_items_by_ids,
      }),
    );

    expect(service.build_item_records_by_ids("E:/demo/demo.lg", [2, 3])).toMatchObject([
      {
        item_id: 2,
        file_path: "chapter02.txt",
        row_number: 1,
        file_type: "TXT",
        name_src: "Alice",
        extra_field: { note: "keep" },
        tag: "line",
        skip_internal_filter: false,
      },
    ]);
    expect(get_items_by_ids).toHaveBeenCalledWith("E:/demo/demo.lg", [2, 3]);
  });
});
