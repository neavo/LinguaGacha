import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectRuntimeProjectionJsonRecord } from "./project-runtime-projection-service";
import { ProjectRuntimeProjectionService } from "./project-runtime-projection-service";
import { ProjectChangeEventAdapter } from "./project-change-event-adapter";
import { ProjectSessionState } from "./project-session-state";

describe("ProjectChangeEventAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("把 loaded 工程的领域草稿转换为 canonical delta 项目变更事件", () => {
    vi.spyOn(Date, "now").mockReturnValue(36);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const projection_service = create_projection_service({
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
      projection_service,
    );

    const event = adapter.adapt_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: "workbench_add_file",
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
      source: "workbench_add_file",
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
    const projection_service = create_projection_service({
      meta: {},
      get_all_meta: () => {
        throw new Error("未加载工程不应读取 meta");
      },
    });
    const adapter = new ProjectChangeEventAdapter(
      {} as ProjectDatabase,
      new ProjectSessionState(),
      projection_service,
    );

    const event = adapter.adapt_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: null,
      projectRevision: 3,
      updatedSections: ["items", "quality"],
      items: {
        payloadMode: "ids-only",
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
    const projection_service = create_projection_service({
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
      projection_service,
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

  function create_projection_service(options: {
    meta: ProjectRuntimeProjectionJsonRecord;
    item_records?: ProjectRuntimeProjectionJsonRecord[];
    files?: Record<string, ProjectRuntimeProjectionJsonRecord>;
    section_payloads?: Record<string, ProjectRuntimeProjectionJsonRecord>;
    get_all_meta?: (project_path: string) => ProjectRuntimeProjectionJsonRecord;
  }): ProjectRuntimeProjectionService {
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
      get_runtime_section_revision: (_meta: ProjectRuntimeProjectionJsonRecord, section: string) =>
        Number(revision_map[section as keyof typeof revision_map] ?? 0),
      build_item_records_by_ids: (_project_path: string, item_ids: number[]) =>
        (options.item_records ?? []).filter((record) =>
          item_ids.includes(Number(record["item_id"] ?? 0)),
        ),
      build_files_record_block: () => options.files ?? {},
      build_section_payloads: (_args: unknown) => ({
        sections: options.section_payloads ?? {},
      }),
    } as unknown as ProjectRuntimeProjectionService;
  }
});
