import { describe, expect, it, vi } from "vitest";
import type { ProjectItemPublicRecord } from "@base/item";
import type { ProjectChangeJsonRecord } from "@shared/project/event";

import {
  createProjectStore,
  type ProjectStoreChangeEvent,
  type ProjectStoreSectionStateMap,
  type ProjectStoreStage,
} from "./project-store";

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

type ProjectStoreChangeOperation = ProjectStoreChangeEvent["operations"][number];

// 测试只构造已规范化的后端变更载荷，不恢复页面侧 canonical 写入口
function create_replace_section_operation(
  section: ProjectStoreStage,
  value: unknown,
): ProjectStoreChangeOperation {
  const sections = {
    [section]: {
      payloadMode: "canonical-delta",
      data: value,
    },
  } as ProjectStoreChangeOperation["sections"];
  return { sections };
}

// items delta 测试沿用公开完整 DTO，瘦身 DTO 由独立用例直接穿过 store 校验
function create_items_delta_operation(args: {
  upsertItems?: ProjectItemPublicRecord[];
  deleteIds?: Array<number | string>;
}): ProjectStoreChangeOperation {
  const upsert_items = args.upsertItems ?? [];
  const upsert = Object.fromEntries(
    upsert_items.map((item) => [String(item.item_id), item as unknown as ProjectChangeJsonRecord]),
  );
  const delete_ids = [...new Set((args.deleteIds ?? []).map((item_id) => Number(item_id)))].filter(
    (item_id) => Number.isInteger(item_id) && item_id > 0,
  );
  return {
    items: {
      payloadMode: "canonical-delta",
      ...(upsert_items.length > 0
        ? {
            upsert,
            changedIds: [...new Set(upsert_items.map((item) => item.item_id))],
          }
        : {}),
      ...(delete_ids.length > 0 ? { deleteIds: delete_ids } : {}),
    },
  };
}

// files delta 的公开 key 是相对路径，测试侧保持与后端事件一致的 tombstone 语义
function create_files_delta_operation(args: {
  upsertFiles?: Record<string, ProjectChangeJsonRecord>;
  deletePaths?: string[];
}): ProjectStoreChangeOperation {
  const upsert = args.upsertFiles ?? {};
  const delete_paths = [
    ...new Set((args.deletePaths ?? []).map((file_path) => file_path.trim()).filter(Boolean)),
  ];
  return {
    files: {
      payloadMode: "canonical-delta",
      ...(Object.keys(upsert).length > 0 ? { upsert, changedPaths: Object.keys(upsert) } : {}),
      ...(delete_paths.length > 0 ? { deletePaths: delete_paths } : {}),
    },
  };
}

function apply_store_sections(
  store: ReturnType<typeof createProjectStore>,
  args: {
    projectRevision: number;
    sectionRevisions?: Partial<Record<ProjectStoreStage, number>>;
    sections: Partial<Record<ProjectStoreStage, unknown>>;
  },
): void {
  const project_section = args.sections.project as { path?: unknown } | undefined;
  const updated_sections = Object.keys(args.sections).filter(
    (section): section is ProjectStoreStage =>
      ["project", "files", "items", "quality", "prompts", "analysis", "proofreading"].includes(
        section,
      ),
  );

  store.applyProjectChange(
    {
      source: "project_read_sections",
      projectPath: String(project_section?.path ?? "E:/demo/demo.lg"),
      projectRevision: args.projectRevision,
      updatedSections: updated_sections,
      sectionRevisions: args.sectionRevisions,
      operations: updated_sections.map((section) =>
        create_replace_section_operation(
          section,
          args.sections[section] as ProjectStoreSectionStateMap[typeof section],
        ),
      ),
    },
    {
      revisionMode: "exact",
    },
  );
}

describe("createProjectStore", () => {
  it("按 section 独立写入读取到的项目数据", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 1,
      sectionRevisions: {
        project: 1,
        items: 3,
      },
      sections: {
        project: { path: "E:/demo/demo.lg", loaded: true },
        items: {
          1: create_test_item({
            item_id: 1,
            file_path: "chapter01.txt",
          }),
          2: create_test_item({
            item_id: 2,
            file_path: "chapter02.txt",
          }),
        },
      },
    });

    expect(store.getState().project.path).toBe("E:/demo/demo.lg");
    expect([...store.getState().items.keys()]).toEqual(["1", "2"]);
    expect(store.getState().revisions.projectRevision).toBe(1);
    expect(store.getState().revisions.sections.items).toBe(3);
  });

  it("合并项目变更不会为缺失后端 revision 的 section 自增", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 2,
      sectionRevisions: {
        items: 2,
      },
      sections: {
        items: {
          1: create_test_item({
            item_id: 1,
            file_path: "chapter01.txt",
            src: "原文",
            dst: "旧译文",
            status: "NONE",
          }),
        },
      },
    });

    store.applyProjectChange({
      source: "task",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 3,
      updatedSections: ["items"],
      operations: [
        create_items_delta_operation({
          upsertItems: [
            create_test_item({
              item_id: 1,
              file_path: "chapter01.txt",
              src: "原文",
              dst: "新译文",
              status: "PROCESSED",
            }),
          ],
        }),
      ],
    });

    expect(store.getState().items.get(1)).toEqual(
      create_test_item({
        item_id: 1,
        file_path: "chapter01.txt",
        src: "原文",
        dst: "新译文",
        status: "PROCESSED",
      }),
    );
    expect(store.getState().revisions.projectRevision).toBe(3);
    expect(store.getState().revisions.sections.items).toBe(2);
  });

  it("批量应用项目变更时保持顺序且不发明 section revision", () => {
    const store = createProjectStore();
    const listener = vi.fn();

    store.subscribe(listener);
    store.applyProjectChangeBatch([
      {
        source: "translation_batch",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 2,
        updatedSections: ["items"],
        operations: [
          create_items_delta_operation({
            upsertItems: [
              create_test_item({
                item_id: 1,
                file_path: "chapter01.txt",
                src: "原文",
                dst: "第一版",
                status: "NONE",
              }),
            ],
          }),
        ],
      },
      {
        source: "translation_batch",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 3,
        updatedSections: ["items"],
        operations: [
          create_items_delta_operation({
            upsertItems: [
              create_test_item({
                item_id: 1,
                file_path: "chapter01.txt",
                src: "原文",
                dst: "第二版",
                status: "PROCESSED",
              }),
            ],
          }),
        ],
      },
    ]);

    expect(store.getState().items.get(1)).toMatchObject({
      dst: "第二版",
      status: "PROCESSED",
    });
    expect(store.getState().revisions.projectRevision).toBe(3);
    expect(store.getState().revisions.sections.items).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("拒绝把瘦身 item upsert 写入共享 ProjectStore", () => {
    const store = createProjectStore();

    expect(() =>
      store.applyProjectChange({
        source: "translation_batch_update",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 1,
        updatedSections: ["items"],
        operations: [
          {
            items: {
              payloadMode: "canonical-delta",
              upsert: {
                1: {
                  item_id: 1,
                  file_path: "chapter01.txt",
                },
              },
              changedIds: [1],
            },
          },
        ],
      }),
    ).toThrow("runtime.internal_invariant");
  });

  it("对缺省 projectRevision 的项目变更保留已有 revision", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 5,
      sectionRevisions: {
        items: 2,
      },
      sections: {
        items: {
          1: create_test_item({
            item_id: 1,
            file_path: "chapter01.txt",
            src: "原文",
            dst: "旧译文",
            status: "NONE",
          }),
        },
      },
    });

    store.applyProjectChange({
      source: "translation_batch_update",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 0,
      updatedSections: ["items"],
      operations: [
        create_items_delta_operation({
          upsertItems: [
            create_test_item({
              item_id: 1,
              file_path: "chapter01.txt",
              src: "原文",
              dst: "批次译文",
              status: "PROCESSED",
            }),
          ],
        }),
      ],
    });

    expect(store.getState().items.get(1)).toEqual(
      create_test_item({
        item_id: 1,
        file_path: "chapter01.txt",
        src: "原文",
        dst: "批次译文",
        status: "PROCESSED",
      }),
    );
    expect(store.getState().revisions.projectRevision).toBe(5);
    expect(store.getState().revisions.sections.items).toBe(2);
  });

  it("显式删除 items/files 并返回变更摘要", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 4,
      sectionRevisions: {
        project: 1,
        items: 4,
        files: 2,
      },
      sections: {
        project: { path: "E:/demo/demo.lg", loaded: true },
        files: {
          "a.txt": { rel_path: "a.txt" },
          "b.txt": { rel_path: "b.txt" },
        },
        items: {
          1: create_test_item({ item_id: 1, file_path: "a.txt" }),
          2: create_test_item({ item_id: 2, file_path: "b.txt" }),
        },
      },
    });

    const result = store.applyProjectChange({
      source: "workbench_delete_file",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 6,
      updatedSections: ["files", "items"],
      sectionRevisions: {
        files: 3,
        items: 5,
      },
      operations: [
        create_files_delta_operation({ deletePaths: ["a.txt"] }),
        create_items_delta_operation({ deleteIds: [1] }),
      ],
    });

    expect(store.getState().files).toEqual({
      "b.txt": { rel_path: "b.txt" },
    });
    expect(store.getState().items.toRecordSnapshot()).toEqual({
      2: create_test_item({ item_id: 2, file_path: "b.txt" }),
    });
    expect(result.fileDelta).toEqual({
      upsertFilePaths: [],
      deleteFilePaths: ["a.txt"],
      fullReplace: false,
    });
    expect(result.itemDelta).toEqual({
      upsertItemIds: [],
      deleteItemIds: [1],
      fullReplace: false,
    });
    expect(store.getRevisionCheckpoint()).toEqual({
      projectPath: "E:/demo/demo.lg",
      sections: {
        project: 1,
        files: 3,
        items: 5,
      },
    });
  });

  it("从 prompts 快照的顶层 enabled 归一化提示词启用态", () => {
    const store = createProjectStore();
    const initial_prompts = {
      translation: {
        revision: 10,
        enabled: false,
        text: "旧提示词",
      },
      analysis: {
        revision: 3,
        enabled: false,
        text: "分析提示词",
      },
    } as unknown as ReturnType<typeof store.getState>["prompts"];
    const patched_prompts = {
      translation: {
        revision: 11,
        enabled: true,
        text: "新提示词",
      },
      analysis: {
        revision: 3,
        enabled: false,
        text: "分析提示词",
      },
    } as unknown as ReturnType<typeof store.getState>["prompts"];

    apply_store_sections(store, {
      projectRevision: 7,
      sectionRevisions: {
        prompts: 4,
      },
      sections: {
        prompts: initial_prompts,
      },
    });

    store.applyProjectChange({
      source: "quality_prompt_save",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 8,
      updatedSections: ["prompts"],
      sectionRevisions: {
        prompts: 5,
      },
      operations: [create_replace_section_operation("prompts", patched_prompts)],
    });

    expect(store.getState().prompts.translation).toEqual({
      text: "新提示词",
      enabled: true,
      revision: 11,
    });
    expect(store.getState().revisions.projectRevision).toBe(8);
    expect(store.getState().revisions.sections.prompts).toBe(5);
  });

  it("按质量规则槽位归一缺失 meta，不让术语表默认值泄漏到替换规则", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 7,
      sectionRevisions: {
        quality: 4,
      },
      sections: {
        quality: {
          glossary: {
            entries: [{ src: "HP", dst: "生命值" }],
            revision: 4,
          },
          pre_replacement: {
            entries: [{ src: "A", dst: "B" }],
            revision: 4,
          },
          text_preserve: {
            entries: [],
            revision: 4,
          },
        } as unknown as ProjectStoreSectionStateMap["quality"],
      },
    });

    expect(store.getState().quality.glossary.enabled).toBe(true);
    expect(store.getState().quality.pre_replacement.enabled).toBe(false);
    expect(store.getState().quality.post_replacement.enabled).toBe(false);
    expect(store.getState().quality.text_preserve.mode).toBe("smart");
  });

  it("后端 exact 补读按返回快照覆盖 section 数据和 revision", () => {
    const store = createProjectStore();
    const initial_quality = {
      glossary: {
        entries: [
          {
            id: "1",
            src: "旧原文",
            dst: "旧译文",
          },
        ],
        enabled: true,
        mode: "off",
        revision: 3,
      },
      pre_replacement: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
      post_replacement: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
      text_preserve: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
    };

    apply_store_sections(store, {
      projectRevision: 5,
      sectionRevisions: {
        quality: 3,
      },
      sections: {
        quality: initial_quality,
      },
    });

    const server_quality = {
      ...store.getState().quality,
      glossary: {
        ...store.getState().quality.glossary,
        entries: [],
        revision: 2,
      },
    };

    store.applyProjectChange(
      {
        source: "project_read_sections",
        projectPath: "E:/demo/demo.lg",
        projectRevision: 4,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 2,
        },
        operations: [create_replace_section_operation("quality", server_quality)],
      },
      {
        revisionMode: "exact",
      },
    );

    expect(store.getState().quality.glossary.revision).toBe(2);
    expect(store.getState().quality.glossary.entries).toEqual([]);
    expect(store.getState().revisions.projectRevision).toBe(4);
    expect(store.getState().revisions.sections.quality).toBe(2);
  });

  it("merge 模式应用 canonical payload 时保持 section revision 单调", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 5,
      sectionRevisions: {
        quality: 3,
      },
      sections: {
        quality: {
          glossary: {
            entries: [],
            enabled: true,
            mode: "off",
            revision: 3,
          },
          pre_replacement: {
            entries: [],
            enabled: false,
            mode: "off",
            revision: 0,
          },
          post_replacement: {
            entries: [],
            enabled: false,
            mode: "off",
            revision: 0,
          },
          text_preserve: {
            entries: [],
            enabled: false,
            mode: "off",
            revision: 0,
          },
        },
      },
    });

    const server_quality = {
      ...store.getState().quality,
      glossary: {
        ...store.getState().quality.glossary,
        entries: [
          {
            id: "1",
            src: "原文",
            dst: "后端译文",
          },
        ],
      },
    };

    store.applyProjectChange({
      source: "quality_rule_save_entries",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 6,
      updatedSections: ["quality"],
      sectionRevisions: {
        quality: 2,
      },
      operations: [create_replace_section_operation("quality", server_quality)],
    });

    expect(store.getState().quality.glossary.entries).toEqual([
      {
        id: "1",
        src: "原文",
        dst: "后端译文",
      },
    ]);
    expect(store.getState().revisions.projectRevision).toBe(6);
    expect(store.getState().revisions.sections.quality).toBe(3);
  });

  it("初始化快照原子替换旧项目数据并采用后端 section revision", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 6,
      sectionRevisions: {
        analysis: 4,
      },
      sections: {
        analysis: {
          extras: {},
          candidate_count: 2,
          candidate_aggregate: {},
          status_summary: {
            total_line: 3,
            processed_line: 1,
            error_line: 1,
            line: 2,
          },
        },
      },
    });

    store.replaceProjectData({
      source: "project_read_sections",
      projectPath: "E:/demo/next.lg",
      projectRevision: 11,
      updatedSections: ["project", "analysis"],
      sectionRevisions: {
        project: 1,
        analysis: 9,
      },
      operations: [
        create_replace_section_operation("project", {
          path: "E:/demo/next.lg",
          loaded: true,
        }),
        create_replace_section_operation("analysis", {
          extras: {
            start_time: 12,
            time: 6,
            total_line: 3,
            line: 1,
            processed_line: 1,
            error_line: 0,
          },
          candidate_count: 2,
          candidate_aggregate: {},
          status_summary: {
            total_line: 3,
            processed_line: 1,
            error_line: 0,
            line: 1,
          },
        }),
      ],
    });

    expect(store.getState().project.path).toBe("E:/demo/next.lg");
    expect(store.getState().items.toRecordSnapshot()).toEqual({});
    expect(store.getState().revisions.projectRevision).toBe(11);
    expect(store.getState().revisions.sections.project).toBe(1);
    expect(store.getState().revisions.sections.analysis).toBe(9);
  });
});
