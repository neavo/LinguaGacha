import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { ApiStreamHub } from "../api/api-stream-hub";
import { ProjectDatabase } from "../database/database-operations";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { ProjectChangeEvent } from "../../shared/project-event";
import { ProjectDataReader, type ProjectDataJsonRecord } from "./project-data";
import { ProjectEventBus } from "./project-events";
import { ProjectSessionState } from "./project-session";
import {
  compute_project_prefilter_write,
  ProjectWriteCoordinator,
  ProjectChangeEventAdapter,
  ProjectChangePublisher,
  type ProjectWriteState,
} from "./project-changes";

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
function create_state(items: Record<string, Partial<ProjectItemPublicRecord>>): ProjectWriteState {
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

describe("compute_project_prefilter_write", () => {
  it("按规则和输入语言生成跳过状态，并把项目设置镜像写入输出", () => {
    const output = compute_project_prefilter_write({
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

  it("启用 MTool 优化器时只在后端计算 KVJSON 重复短句跳过", () => {
    const output = compute_project_prefilter_write({
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

  it("任意源语言下空白原文仍按规则过滤并统计", () => {
    const output = compute_project_prefilter_write({
      state: create_state({
        "1": {
          item_id: 1,
          file_path: "script.txt",
          row_number: 1,
          src: "",
          status: "NONE",
        },
        "2": {
          item_id: 2,
          file_path: "script.txt",
          row_number: 2,
          src: "　",
          status: "NONE",
        },
      }),
      source_language: "ALL",
      target_language: "ZH",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(output.items["1"].status).toBe("RULE_SKIPPED");
    expect(output.items["2"].status).toBe("RULE_SKIPPED");
    expect(output.stats.rule_skipped).toBe(2);
    expect(output.stats.language_skipped).toBe(0);
  });

  it("强制翻译条目绕过规则和语言预过滤并保留运行态字段", () => {
    const output = compute_project_prefilter_write({
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
    const output = compute_project_prefilter_write({
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
    const output = compute_project_prefilter_write({
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
    const output = compute_project_prefilter_write({
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

describe("ProjectChangeEventAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("把 loaded 工程的领域草稿转换为规范化增量项目变更事件", () => {
    vi.spyOn(Date, "now").mockReturnValue(36);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const data_reader = create_data_reader({
      meta: {
        "project_runtime_revision.files": 5,
        "project_runtime_revision.items": 7,
        "project_runtime_revision.analysis": 4,
      },
      item_records: [
        { item_id: 2, src: "勇者" },
        { item_id: 3, src: "魔王" },
      ],
      files: {
        "a.txt": { rel_path: "a.txt", file_type: "TXT", sort_index: 0 },
        "b.txt": { rel_path: "b.txt", file_type: "TXT", sort_index: 1 },
      },
      section_payloads: {
        analysis: {
          extras: {},
          candidate_count: 1,
          status_summary: { total_line: 2, processed_line: 1, error_line: 0, line: 1 },
        },
      },
    });
    const adapter = new ProjectChangeEventAdapter(
      {} as ProjectDatabase,
      session_state,
      data_reader,
    );

    const event = adapter.adapt_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: "workbench_import_files",
      updatedSections: ["items", "files", "analysis", "items", "unknown"],
      items: {
        payloadMode: "canonical-delta",
        upsert: {
          "2": { item_id: 2, src: "调用方伪造" },
        },
        changedIds: [2, "3", 2, -1, "坏值"],
        deleteIds: [8, 8],
      },
      files: {
        payloadMode: "canonical-delta",
        upsert: {
          "a.txt": { rel_path: "a.txt", file_type: "FAKE", sort_index: 99 },
        },
        changedPaths: [" b.txt ", "", "a.txt", "a.txt"],
      },
      sections: {
        analysis: { payloadMode: "canonical-delta", data: { candidate_count: 999 } },
      },
    });

    expect(event).toEqual({
      type: "project.changed",
      eventId: "10-i",
      source: "workbench_import_files",
      projectPath: "E:/Project/demo.lg",
      projectRevision: 7,
      sectionRevisions: {
        items: 7,
        files: 5,
        analysis: 4,
      },
      updatedSections: ["items", "files", "analysis"],
      items: {
        payloadMode: "canonical-delta",
        upsert: {
          "2": { item_id: 2, src: "勇者" },
          "3": { item_id: 3, src: "魔王" },
        },
        changedIds: [2, 3],
        deleteIds: [8],
      },
      files: {
        payloadMode: "canonical-delta",
        upsert: {
          "a.txt": { rel_path: "a.txt", file_type: "TXT", sort_index: 0 },
          "b.txt": { rel_path: "b.txt", file_type: "TXT", sort_index: 1 },
        },
        changedPaths: ["b.txt", "a.txt"],
      },
      sections: {
        analysis: {
          payloadMode: "canonical-delta",
          data: {
            candidate_count: 999,
          },
        },
      },
    });
  });

  it("未加载工程时不广播项目数据变更", () => {
    const data_reader = create_data_reader({
      meta: {},
      get_all_meta: () => {
        throw new Error("未加载工程不应读取 meta");
      },
    });
    const adapter = new ProjectChangeEventAdapter(
      {} as ProjectDatabase,
      new ProjectSessionState(),
      data_reader,
    );

    const event = adapter.adapt_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: null,
      projectRevision: 3,
      updatedSections: ["items", "quality"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: [1],
      },
      sections: {
        quality: { payloadMode: "坏模式" },
      },
    });

    expect(event).toBeNull();
  });

  it("显式 section payload 可把 items/files 发布为后端 canonical 完整替换", () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const data_reader = create_data_reader({
      meta: {
        "project_runtime_revision.files": 2,
        "project_runtime_revision.items": 3,
      },
      section_payloads: {
        items: {
          "1": { item_id: 1, src: "勇者" },
        },
        files: {
          "a.txt": { rel_path: "a.txt", file_type: "TXT", sort_index: 0 },
        },
      },
    });
    const adapter = new ProjectChangeEventAdapter(
      {} as ProjectDatabase,
      session_state,
      data_reader,
    );

    const event = adapter.adapt_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: "workbench_reset_file",
      updatedSections: ["items", "files"],
      sections: {
        items: { payloadMode: "canonical-delta" },
        files: { payloadMode: "canonical-delta" },
      },
    });

    expect(event).toMatchObject({
      source: "workbench_reset_file",
      updatedSections: ["items", "files"],
      sectionRevisions: {
        items: 3,
        files: 2,
      },
      sections: {
        items: {
          payloadMode: "canonical-delta",
          data: {
            "1": { item_id: 1, src: "勇者" },
          },
        },
        files: {
          payloadMode: "canonical-delta",
          data: {
            "a.txt": { rel_path: "a.txt", file_type: "TXT", sort_index: 0 },
          },
        },
      },
    });
  });

  it("字段级 item patch 作为后端事实增量发布且不回读完整 item", () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const build_item_records_by_ids = vi.fn(() => {
      throw new Error("字段 patch 不应回读完整 item DTO");
    });
    const data_reader = {
      ...create_data_reader({
        meta: {
          "project_runtime_revision.items": 9,
        },
      }),
      build_item_records_by_ids,
    } as unknown as ProjectDataReader;
    const adapter = new ProjectChangeEventAdapter(
      {} as ProjectDatabase,
      session_state,
      data_reader,
    );

    const event = adapter.adapt_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: "proofreading_set_status",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1, "2", 2, -1],
        fieldPatch: {
          status: "PROCESSED",
          retry_count: 0,
          dst: 123,
        },
      },
    });

    expect(event).toMatchObject({
      source: "proofreading_set_status",
      updatedSections: ["items", "proofreading"],
      sectionRevisions: {
        items: 9,
        proofreading: 0,
      },
      items: {
        payloadMode: "field-patch",
        changedIds: [1, 2],
        fieldPatch: {
          status: "PROCESSED",
          retry_count: 0,
        },
      },
    });
    expect(build_item_records_by_ids).not.toHaveBeenCalled();
  });

  function create_data_reader(options: {
    meta: ProjectDataJsonRecord;
    item_records?: ProjectDataJsonRecord[];
    files?: Record<string, ProjectDataJsonRecord>;
    section_payloads?: Record<string, ProjectDataJsonRecord>;
    get_all_meta?: (project_path: string) => ProjectDataJsonRecord;
  }): ProjectDataReader {
    const revision_map = {
      project: 0,
      files: Number(options.meta["project_runtime_revision.files"] ?? 0),
      items: Number(options.meta["project_runtime_revision.items"] ?? 0),
      quality: Number(options.meta["quality_rule_revision.glossary"] ?? 0),
      prompts: Number(options.meta["quality_prompt_revision.translation"] ?? 0),
      analysis: Number(options.meta["project_runtime_revision.analysis"] ?? 0),
      proofreading: Number(options.meta["proofreading_revision.proofreading"] ?? 0),
    };
    return {
      get_all_meta: options.get_all_meta ?? (() => options.meta),
      build_section_revisions: () => revision_map,
      get_section_revision: (_meta: ProjectDataJsonRecord, section: string) =>
        Number(revision_map[section as keyof typeof revision_map] ?? 0),
      build_item_records_by_ids: (_project_path: string, item_ids: number[]) =>
        (options.item_records ?? []).filter((record) =>
          item_ids.includes(Number(record["item_id"] ?? 0)),
        ),
      build_files_record_block: () => options.files ?? {},
      build_section_payloads: (_args: unknown) => ({
        sections: options.section_payloads ?? {},
      }),
    } as unknown as ProjectDataReader;
  }
});

describe("ProjectChangePublisher", () => {
  it("把领域变更草稿适配后广播为 project.data_changed 事件", async () => {
    const api_stream_hub = new ApiStreamHub();
    const response = api_stream_hub.create_stream_response();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const publisher = new ProjectChangePublisher(
      {
        adapt_project_change: (payload) => ({
          type: "project.changed",
          eventId: "evt-1",
          source: String(payload["source"] ?? ""),
          projectPath: String(payload["targetProjectPath"] ?? ""),
          projectRevision: 2,
          sectionRevisions: { items: 2 },
          updatedSections: ["items"],
        }),
      } as ProjectChangeEventAdapter,
      api_stream_hub,
    );

    publisher.publish_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: "translation_reset",
    });
    const chunk = await reader?.read();
    await reader?.cancel();
    api_stream_hub.stop();

    const frame = new TextDecoder().decode(chunk?.value);
    const event_line = frame.split("\n").find((line) => line.startsWith("event: "));
    const data_line = frame.split("\n").find((line) => line.startsWith("data: "));

    expect(event_line).toBe("event: project.data_changed");
    expect(JSON.parse(data_line?.slice("data: ".length) ?? "{}")).toEqual({
      type: "project.changed",
      eventId: "evt-1",
      source: "translation_reset",
      projectPath: "E:/Project/demo.lg",
      projectRevision: 2,
      sectionRevisions: { items: 2 },
      updatedSections: ["items"],
    });
  });

  it("适配器判定无可广播事件时不写入事件流", async () => {
    const api_stream_hub = new ApiStreamHub();
    const publisher = new ProjectChangePublisher(
      {
        adapt_project_change: () => null,
      } as unknown as ProjectChangeEventAdapter,
      api_stream_hub,
    );

    const event = publisher.publish_project_change({
      targetProjectPath: "E:/Project/other.lg",
      source: "settings_alignment",
    });

    api_stream_hub.stop();
    expect(event).toBeNull();
  });
});

let temp_dir = "";

/**
 * 每个用例使用独立临时工程，避免 revision meta 互相污染
 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

/**
 * 创建只回显草稿的发布器，便于断言 coordinator 生成的规范化 payload
 */
function create_echo_project_change_publisher(): {
  publish_project_change: ReturnType<typeof vi.fn>;
} {
  return {
    publish_project_change: vi.fn((payload: Record<string, ApiJsonValue>): ProjectChangeEvent => {
      const updated_sections = Array.isArray(payload.updatedSections)
        ? payload.updatedSections.map((section) => String(section))
        : [];
      return {
        type: "project.changed",
        eventId: `test-${String(payload.source ?? "project_change")}`,
        source: String(payload.source ?? "project_change"),
        projectPath: String(payload.targetProjectPath ?? ""),
        projectRevision: 0,
        sectionRevisions: {},
        updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
        ...(payload.items === undefined
          ? {}
          : { items: payload.items as ProjectChangeEvent["items"] }),
        ...(payload.files === undefined
          ? {}
          : { files: payload.files as ProjectChangeEvent["files"] }),
        ...(payload.sections === undefined
          ? {}
          : { sections: payload.sections as ProjectChangeEvent["sections"] }),
      };
    }),
  };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-write-coordinator-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectWriteCoordinator", () => {
  it("用同一 meta 快照校验 revision 并生成运行态 bump 操作", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 2 },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "proofreading_revision.proofreading", value: 3 },
    });
    const coordinator = new ProjectWriteCoordinator(database, null, new ProjectEventBus());

    const context = coordinator.assert_expected_section_revisions(
      lg_path,
      { items: 2, proofreading: 3 },
      ["items", "proofreading"],
    );

    expect(coordinator.build_section_revision_operations(context)).toEqual([
      {
        name: "setMeta",
        args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 3 },
      },
      {
        name: "setMeta",
        args: { projectPath: lg_path, key: "proofreading_revision.proofreading", value: 4 },
      },
    ]);
    database.close();
  });

  it("统一提交方法在 revision 冲突时不构造事务且不发布事件", async () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 1 },
    });
    const publisher = create_echo_project_change_publisher();
    const coordinator = new ProjectWriteCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new ProjectEventBus(),
    );
    const build_operations = vi.fn(() => []);

    await expect(
      coordinator.commit_project_write({
        projectPath: lg_path,
        expectedSectionRevisions: { items: 0 },
        sections: ["items"],
        buildOperations: build_operations,
        change: { source: "translation_reset", updatedSections: ["items"] },
      }),
    ).rejects.toThrow("data.revision_conflict");

    expect(build_operations).not.toHaveBeenCalled();
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
    database.close();
  });

  it("统一提交方法在同一提交点写事务并发布 canonical 草稿", async () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    const publisher = create_echo_project_change_publisher();
    const coordinator = new ProjectWriteCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new ProjectEventBus(),
    );

    const result = await coordinator.commit_project_write({
      projectPath: lg_path,
      expectedSectionRevisions: { items: 0 },
      sections: ["items"],
      buildOperations: (context) => coordinator.build_section_revision_operations(context),
      change: { source: "translation_reset", updatedSections: ["items"] },
    });

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "project_runtime_revision.items", default: 0 },
      }),
    ).toBe(1);
    expect(result.changes).toEqual([
      expect.objectContaining({
        projectPath: lg_path,
        source: "translation_reset",
        updatedSections: ["items"],
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "translation_reset",
      updatedSections: ["items"],
      sections: {
        items: { payloadMode: "canonical-delta" },
      },
    });
    database.close();
  });

  it("事务成功后先发布内部 committed event，再发布公开项目变更", async () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    const calls: string[] = [];
    const project_event_bus = new ProjectEventBus();
    project_event_bus.subscribe("project.items.changed", (event) => {
      calls.push(`internal:${event.sectionRevisions.items ?? 0}`);
    });
    const publisher = {
      publish_project_change: vi.fn(() => {
        calls.push("public");
        return {
          type: "project.changed",
          eventId: "test-event",
          source: "translation_reset",
          projectPath: lg_path,
          projectRevision: 1,
          sectionRevisions: { items: 1 },
          updatedSections: ["items"],
        } satisfies ProjectChangeEvent;
      }),
    };
    const coordinator = new ProjectWriteCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      project_event_bus,
    );

    await coordinator.commit_project_write({
      projectPath: lg_path,
      expectedSectionRevisions: { items: 0 },
      sections: ["items"],
      buildOperations: (context) => coordinator.build_section_revision_operations(context),
      change: { source: "translation_reset", updatedSections: ["items"] },
    });

    expect(calls).toEqual(["internal:1", "public"]);
    database.close();
  });

  it("内部 committed event 失败时阻断公开项目变更", async () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    const project_event_bus = new ProjectEventBus();
    const dispatch_error = new Error("cache update failed");
    project_event_bus.subscribe("project.items.changed", () => {
      throw dispatch_error;
    });
    const publisher = create_echo_project_change_publisher();
    const coordinator = new ProjectWriteCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      project_event_bus,
    );

    await expect(
      coordinator.commit_project_write({
        projectPath: lg_path,
        expectedSectionRevisions: { items: 0 },
        sections: ["items"],
        buildOperations: (context) => coordinator.build_section_revision_operations(context),
        change: { source: "translation_reset", updatedSections: ["items"] },
      }),
    ).rejects.toBe(dispatch_error);

    expect(publisher.publish_project_change).not.toHaveBeenCalled();
    database.close();
  });

  it("拒绝字符串、布尔值和小数 revision，避免旧兼容锁值进入写入口", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    const coordinator = new ProjectWriteCoordinator(database, null, new ProjectEventBus());

    for (const bad_revision of ["0", true, 1.5] as ApiJsonValue[]) {
      expect(() =>
        coordinator.assert_expected_section_revisions(lg_path, { items: bad_revision }, ["items"]),
      ).toThrow("request.validation_failed");
    }
    database.close();
  });

  it("默认把 updated section 发布成 canonical section data 草稿", () => {
    const database = new ProjectDatabase();
    const publisher = create_echo_project_change_publisher();
    const coordinator = new ProjectWriteCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new ProjectEventBus(),
    );

    const result = coordinator.publish_project_data_change({
      projectPath: "E:/Project/demo.lg",
      source: "workbench_reset_file",
      updatedSections: ["items", "analysis"],
    });

    expect(result.changes).toEqual([
      expect.objectContaining({
        source: "workbench_reset_file",
        sections: {
          items: { payloadMode: "canonical-delta" },
          analysis: { payloadMode: "canonical-delta" },
        },
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: "E:/Project/demo.lg",
      source: "workbench_reset_file",
      updatedSections: ["items", "analysis"],
      sections: {
        items: { payloadMode: "canonical-delta" },
        analysis: { payloadMode: "canonical-delta" },
      },
    });
    database.close();
  });

  it("行级 items delta 存在时只为其它 section 生成完整 canonical data", () => {
    const database = new ProjectDatabase();
    const publisher = create_echo_project_change_publisher();
    const coordinator = new ProjectWriteCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new ProjectEventBus(),
    );

    coordinator.publish_project_data_change({
      projectPath: "E:/Project/demo.lg",
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: { payloadMode: "canonical-delta", changedIds: [1] },
    });

    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: "E:/Project/demo.lg",
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: { payloadMode: "canonical-delta", changedIds: [1] },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
    database.close();
  });
});
