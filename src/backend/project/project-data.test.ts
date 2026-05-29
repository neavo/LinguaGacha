import { describe, expect, it, vi } from "vitest";
import { build_section_revisions_from_meta, get_section_revision } from "./project-data";
import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import { ProjectDataReader } from "./project-data";

describe("project section revision", () => {
  it("从 meta 归一项目数据 section revision 并过滤坏值", () => {
    const meta = {
      "project_runtime_revision.files": -1,
      "project_runtime_revision.items": "9.7",
      "project_runtime_revision.analysis": 4,
      "proofreading_revision.proofreading": "6.2",
      "quality_rule_revision.glossary": 2,
      "quality_rule_revision.text_preserve": "5.9",
      "quality_rule_revision.pre_replacement": "坏值",
      "quality_rule_revision.post_replacement": 3,
      "quality_prompt_revision.translation": "8.8",
      "quality_prompt_revision.analysis": Number.NaN,
    };

    expect(get_section_revision(meta, "files")).toBe(0);
    expect(get_section_revision(meta, "items")).toBe(9);
    expect(get_section_revision(meta, "analysis")).toBe(4);
    expect(get_section_revision(meta, "proofreading")).toBe(6);
    expect(get_section_revision(meta, "quality:glossary")).toBe(2);
    expect(get_section_revision(meta, "quality")).toBe(5);
    expect(get_section_revision(meta, "prompts:translation")).toBe(8);
    expect(get_section_revision(meta, "prompts")).toBe(8);
    expect(get_section_revision(meta, "unknown")).toBe(0);
  });

  it("构建完整 section revision 快照", () => {
    const meta = {
      "project_runtime_revision.files": 3,
      "project_runtime_revision.items": 9,
      "project_runtime_revision.analysis": 4,
      "proofreading_revision.proofreading": 6,
      "quality_rule_revision.glossary": 2,
      "quality_prompt_revision.translation": 8,
    };

    expect(build_section_revisions_from_meta(meta)).toEqual({
      project: 0,
      files: 3,
      items: 9,
      quality: 2,
      prompts: 8,
      analysis: 4,
      proofreading: 6,
    });
  });
});

describe("ProjectDataReader", () => {
  it("读取 quality/prompts 时不预热 items 快照", () => {
    const calls: string[] = [];
    const service = new ProjectDataReader(
      create_database_stub((operation) => {
        calls.push(operation.name);
        if (operation.name === "getAllItems") {
          throw new Error("不应读取 items");
        }
        if (operation.name === "getAllMeta") {
          return {};
        }
        if (operation.name === "getRules") {
          return [];
        }
        if (operation.name === "getRuleText") {
          return "";
        }
        return null;
      }),
    );

    service.build_section_payloads({
      projectState: { loaded: true, projectPath: "E:/demo/demo.lg" },
      sections: ["quality", "prompts"],
    });

    expect(calls).toContain("getAllMeta");
    expect(calls).toContain("getRules");
    expect(calls).toContain("getRuleText");
    expect(calls).not.toContain("getAllItems");
  });

  it("prompts section 使用顶层 enabled 表达自定义提示词启用态", () => {
    const service = new ProjectDataReader(
      create_database_stub((operation) => {
        if (operation.name === "getAllMeta") {
          return {
            translation_prompt_enable: true,
            analysis_prompt_enable: false,
            "quality_prompt_revision.translation": 4,
          };
        }
        if (operation.name === "getRuleText") {
          return operation.args?.ruleType === "translation_prompt" ? "翻译提示词" : "分析提示词";
        }
        return null;
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
    expect(prompts["analysis"]).toEqual({
      revision: 4,
      enabled: false,
      text: "分析提示词",
    });
    expect(prompts["translation"]).not.toHaveProperty("meta");
    expect(prompts["translation"]).not.toHaveProperty("task_type");
  });

  it("质量切片缺少 meta 时使用质量规则领域默认值", () => {
    const service = new ProjectDataReader(
      create_database_stub((operation) => {
        if (operation.name === "getAllMeta") {
          return {};
        }
        if (operation.name === "getRules") {
          return operation.args?.ruleType === "glossary" ? [{ src: "HP", dst: "生命值" }] : [];
        }
        return null;
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
      entries: [{ src: "HP", dst: "生命值" }],
    });
    expect(quality["text_preserve"]).toMatchObject({
      enabled: false,
      mode: "smart",
    });
    expect(quality["pre_replacement"]?.enabled).toBe(false);
    expect(quality["post_replacement"]?.enabled).toBe(false);
  });

  it("manifest 计数使用聚合 operation，不为计数扫描完整 item payload", () => {
    const execute = vi.fn((operation: DatabaseOperation) => {
      if (operation.name === "getAllMeta") {
        return {};
      }
      if (operation.name === "getAssetCount") {
        return 2;
      }
      if (operation.name === "getItemCount") {
        return 5;
      }
      if (operation.name === "getAllItems") {
        throw new Error("不应读取 items");
      }
      return null;
    });
    const service = new ProjectDataReader(create_database_stub(execute));

    const manifest = service.build_manifest({ loaded: true, projectPath: "E:/demo/demo.lg" });

    expect(manifest["projectPath"]).toBe("E:/demo/demo.lg");
    expect(manifest["counts"]).toEqual({ files: 2, items: 5 });
    expect(execute).toHaveBeenCalledWith({
      name: "getAssetCount",
      args: { projectPath: "E:/demo/demo.lg" },
    });
    expect(execute).toHaveBeenCalledWith({
      name: "getItemCount",
      args: { projectPath: "E:/demo/demo.lg" },
    });
  });

  it("按 id 读取 item 时只返回后端规范行 DTO", () => {
    const execute = vi.fn((operation: DatabaseOperation) => {
      if (operation.name === "getAllMeta") {
        return {
          "project_runtime_revision.items": 7,
          "project_runtime_revision.files": 3,
          "proofreading_revision.proofreading": 5,
        };
      }
      if (operation.name === "getItemsByIds") {
        return [
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
        ];
      }
      if (operation.name === "getAllItems") {
        throw new Error("不应读取完整 items");
      }
      return null;
    });
    const service = new ProjectDataReader(create_database_stub(execute));

    const records = service.build_item_records_by_ids("E:/demo/demo.lg", [2, 3]);

    expect(records).toMatchObject([
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
    expect(execute).toHaveBeenCalledWith({
      name: "getItemsByIds",
      args: { projectPath: "E:/demo/demo.lg", itemIds: [2, 3] },
    });
  });

  it("analysis section 只从 meta 构建轻量进度，不扫描候选池或 checkpoint", () => {
    const execute = vi.fn((operation: DatabaseOperation) => {
      if (operation.name === "getAllMeta") {
        return {
          analysis_extras: {
            total_line: 8,
            processed_line: 3,
            error_line: 1,
            line: 4,
          },
          analysis_candidate_count: 2,
        };
      }
      if (
        operation.name === "getAnalysisCandidateAggregates" ||
        operation.name === "getAnalysisItemCheckpoints" ||
        operation.name === "getAllItems"
      ) {
        throw new Error("analysis section 不应扫描明细数据");
      }
      return null;
    });
    const service = new ProjectDataReader(create_database_stub(execute));

    const payload = service.build_section_payloads({
      projectState: { loaded: true, projectPath: "E:/demo/demo.lg" },
      sections: ["analysis"],
    });
    const sections = payload["sections"] as Record<string, Record<string, unknown>>;

    expect(sections["analysis"]).toEqual({
      extras: {
        total_line: 8,
        processed_line: 3,
        error_line: 1,
        line: 4,
      },
      candidate_count: 2,
      status_summary: {
        total_line: 8,
        processed_line: 3,
        error_line: 1,
        line: 4,
      },
    });
    expect(execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "getAnalysisCandidateAggregates" }),
    );
  });

  it("analysis 候选载荷只在按需入口读取完整候选池", () => {
    const service = new ProjectDataReader(
      create_database_stub((operation) => {
        if (operation.name === "getAllMeta") {
          return {
            analysis_candidate_count: 1,
            "project_runtime_revision.analysis": 6,
          };
        }
        if (operation.name === "getAnalysisCandidateAggregates") {
          return [
            {
              src: "魔法",
              dst_votes: { magic: 2 },
              info_votes: { 术语: 1 },
              observation_count: 2,
              first_seen_at: "2026-01-01T00:00:00.000Z",
              last_seen_at: "2026-01-02T00:00:00.000Z",
              case_sensitive: true,
              first_seen_index: 3,
            },
            {
              src: "",
              dst_votes: { empty: 1 },
              info_votes: { 术语: 1 },
            },
          ];
        }
        return null;
      }),
    );

    const payload = service.build_analysis_candidate_payload("E:/demo/demo.lg");

    expect(payload).toMatchObject({
      projectPath: "E:/demo/demo.lg",
      candidate_count: 1,
      projectRevision: 6,
      sectionRevisions: {
        analysis: 6,
      },
      candidate_aggregate: {
        魔法: {
          src: "魔法",
          dst_votes: { magic: 2 },
          info_votes: { 术语: 1 },
          observation_count: 2,
          first_seen_index: 3,
        },
      },
    });
  });

  function create_database_stub(
    execute: (operation: DatabaseOperation) => unknown,
  ): ProjectDatabase {
    return {
      execute,
    } as unknown as ProjectDatabase;
  }
});
