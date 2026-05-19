import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import { ProjectRuntimeProjectionService } from "./project-runtime-projection-service";

describe("ProjectRuntimeProjectionService", () => {
  it("读取 quality/prompts 时不预热 items 快照", () => {
    const calls: string[] = [];
    const service = new ProjectRuntimeProjectionService(
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
    const service = new ProjectRuntimeProjectionService(
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
    const service = new ProjectRuntimeProjectionService(
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
    const service = new ProjectRuntimeProjectionService(create_database_stub(execute));

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

  it("按 id 读取 item 时返回项目和 section revision", () => {
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
    const service = new ProjectRuntimeProjectionService(create_database_stub(execute));

    const payload = service.build_item_record_map_by_ids("E:/demo/demo.lg", [2, 3]);

    expect(payload).toMatchObject({
      projectPath: "E:/demo/demo.lg",
      items: {
        "2": {
          item_id: 2,
          file_path: "chapter02.txt",
          row_number: 1,
          file_type: "TXT",
          name_src: "Alice",
          extra_field: { note: "keep" },
          tag: "line",
          skip_internal_filter: false,
        },
      },
      missingIds: [3],
      projectRevision: 7,
      sectionRevisions: {
        items: 7,
        files: 3,
        proofreading: 5,
      },
      itemRevision: 7,
    });
    expect(execute).toHaveBeenCalledWith({
      name: "getItemsByIds",
      args: { projectPath: "E:/demo/demo.lg", itemIds: [2, 3] },
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
