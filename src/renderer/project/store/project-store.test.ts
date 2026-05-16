import { describe, expect, it, vi } from "vitest";
import type { ProjectItemPublicRecord } from "@base/item";

import {
  createProjectStore,
  createProjectStoreFilesDeltaChange,
  createProjectStoreItemsDeltaChange,
  createProjectStoreReplaceSectionChange,
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

function apply_store_sections(
  store: ReturnType<typeof createProjectStore>,
  args: {
    projectRevision: number;
    sectionRevisions?: Partial<Record<ProjectStoreStage, number>>;
    sections: Partial<ProjectStoreSectionStateMap>;
  },
): void {
  const updated_sections = Object.keys(args.sections).filter(
    (section): section is ProjectStoreStage =>
      ["project", "files", "items", "quality", "prompts", "analysis", "proofreading"].includes(
        section,
      ),
  );

  store.applyProjectChange(
    {
      source: "project_read_sections",
      projectRevision: args.projectRevision,
      updatedSections: updated_sections,
      sectionRevisions: args.sectionRevisions,
      operations: updated_sections.map((section) =>
        createProjectStoreReplaceSectionChange(
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
    expect(Object.keys(store.getState().items)).toEqual(["1", "2"]);
    expect(store.getState().revisions.projectRevision).toBe(1);
    expect(store.getState().revisions.sections.items).toBe(3);
  });

  it("合并项目变更只推进项目数据 section", () => {
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
      projectRevision: 3,
      updatedSections: ["items"],
      operations: [
        createProjectStoreItemsDeltaChange({
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

    expect(store.getState().items["1"]).toEqual(create_test_item({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "原文",
      dst: "新译文",
      status: "PROCESSED",
    }));
    expect(store.getState().revisions.projectRevision).toBe(3);
    expect(store.getState().revisions.sections.items).toBe(3);
  });

  it("批量应用项目变更时保持顺序且只通知一次 listener", () => {
    const store = createProjectStore();
    const listener = vi.fn();

    store.subscribe(listener);
    store.applyProjectChangeBatch([
      {
        source: "translation_batch",
        projectRevision: 2,
        updatedSections: ["items"],
        operations: [
          createProjectStoreItemsDeltaChange({
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
        projectRevision: 3,
        updatedSections: ["items"],
        operations: [
          createProjectStoreItemsDeltaChange({
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

    expect(store.getState().items["1"]).toMatchObject({
      dst: "第二版",
      status: "PROCESSED",
    });
    expect(store.getState().revisions.projectRevision).toBe(3);
    expect(store.getState().revisions.sections.items).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("拒绝把瘦身 item upsert 写入共享 ProjectStore", () => {
    expect(() =>
      createProjectStoreItemsDeltaChange({
        upsertItems: [
          {
            item_id: 1,
            file_path: "chapter01.txt",
          },
        ],
      }),
    ).toThrow("完整公开 item DTO");
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
      projectRevision: 0,
      updatedSections: ["items"],
      operations: [
        createProjectStoreItemsDeltaChange({
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

    expect(store.getState().items["1"]).toEqual(create_test_item({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "原文",
      dst: "批次译文",
      status: "PROCESSED",
    }));
    expect(store.getState().revisions.projectRevision).toBe(5);
    expect(store.getState().revisions.sections.items).toBe(3);
  });

  it("显式删除 items/files 并返回变更摘要", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 4,
      sectionRevisions: {
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
      projectRevision: 6,
      updatedSections: ["files", "items"],
      sectionRevisions: {
        files: 3,
        items: 5,
      },
      operations: [
        createProjectStoreFilesDeltaChange({ deletePaths: ["a.txt"] }),
        createProjectStoreItemsDeltaChange({ deleteIds: [1] }),
      ],
    });

    expect(store.getState().files).toEqual({
      "b.txt": { rel_path: "b.txt" },
    });
    expect(store.getState().items).toEqual({
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

  it("从 prompts 快照的 meta.enabled 归一化提示词启用态", () => {
    const store = createProjectStore();
    const initial_prompts = {
      translation: {
        revision: 10,
        meta: {
          enabled: false,
        },
        text: "旧提示词",
      },
      analysis: {
        revision: 3,
        meta: {
          enabled: false,
        },
        text: "分析提示词",
      },
    } as unknown as ReturnType<typeof store.getState>["prompts"];
    const patched_prompts = {
      translation: {
        revision: 11,
        meta: {
          enabled: true,
        },
        text: "新提示词",
      },
      analysis: {
        revision: 3,
        meta: {
          enabled: false,
        },
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
      projectRevision: 8,
      updatedSections: ["prompts"],
      operations: [createProjectStoreReplaceSectionChange("prompts", patched_prompts)],
    });

    expect(store.getState().prompts.translation).toEqual({
      text: "新提示词",
      enabled: true,
      revision: 11,
    });
    expect(store.getState().revisions.projectRevision).toBe(8);
    expect(store.getState().revisions.sections.prompts).toBe(5);
  });

  it("精确 revision 模式允许本地 change 回滚到旧 revision", () => {
    const store = createProjectStore();
    const initial_quality = {
      glossary: {
        entries: [],
        enabled: true,
        mode: "off",
        revision: 2,
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
      projectRevision: 4,
      sectionRevisions: {
        quality: 2,
      },
      sections: {
        quality: initial_quality,
      },
    });

    const optimistic_quality = {
      ...store.getState().quality,
      glossary: {
        ...store.getState().quality.glossary,
        entries: [
          {
            id: "1",
            src: "原文",
            dst: "译文",
          },
        ],
        revision: 3,
      },
    };

    store.applyProjectChange(
      {
        source: "quality_rule_save_entries",
        projectRevision: 5,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 3,
        },
        operations: [createProjectStoreReplaceSectionChange("quality", optimistic_quality)],
      },
      {
        revisionMode: "exact",
      },
    );

    expect(store.getState().quality.glossary.revision).toBe(3);
    expect(store.getState().revisions.projectRevision).toBe(5);
    expect(store.getState().revisions.sections.quality).toBe(3);

    store.applyProjectChange(
      {
        source: "quality_rule_save_entries_rollback",
        projectRevision: 4,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 2,
        },
        operations: [createProjectStoreReplaceSectionChange("quality", initial_quality)],
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

  it("服务器项目变更不会把本地合成 revision 压回去", () => {
    const store = createProjectStore();

    apply_store_sections(store, {
      projectRevision: 4,
      sectionRevisions: {
        quality: 2,
      },
      sections: {
        quality: {
          glossary: {
            entries: [],
            enabled: true,
            mode: "off",
            revision: 2,
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

    const optimistic_quality = {
      ...store.getState().quality,
      glossary: {
        ...store.getState().quality.glossary,
        revision: 3,
      },
    };

    store.applyProjectChange(
      {
        source: "quality_rule_save_entries",
        projectRevision: 5,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 3,
        },
        operations: [createProjectStoreReplaceSectionChange("quality", optimistic_quality)],
      },
      {
        revisionMode: "exact",
      },
    );

    const server_quality = {
      ...store.getState().quality,
      glossary: {
        ...store.getState().quality.glossary,
        entries: [
          {
            id: "1",
            src: "原文",
            dst: "服务器译文",
          },
        ],
      },
    };

    store.applyProjectChange({
      source: "quality_rule_save_entries_confirmed",
      projectRevision: 4,
      updatedSections: ["quality"],
      sectionRevisions: {
        quality: 2,
      },
      operations: [createProjectStoreReplaceSectionChange("quality", server_quality)],
    });

    expect(store.getState().quality.glossary.entries).toEqual([
      {
        id: "1",
        src: "原文",
        dst: "服务器译文",
      },
    ]);
    expect(store.getState().revisions.projectRevision).toBe(5);
    expect(store.getState().revisions.sections.quality).toBe(3);
  });

  it("revision 对齐后下一次本地 change 会从对齐值继续递增", () => {
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

    store.alignRevisions({
      projectRevision: 10,
      sectionRevisions: {
        analysis: 8,
      },
    });

    store.applyProjectChange(
      {
        source: "analysis_reset_failed",
        projectRevision: 11,
        updatedSections: ["analysis"],
        operations: [
          createProjectStoreReplaceSectionChange("analysis", {
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
      },
      {
        revisionMode: "exact",
      },
    );

    expect(store.getState().revisions.projectRevision).toBe(11);
    expect(store.getState().revisions.sections.analysis).toBe(9);
  });
});
