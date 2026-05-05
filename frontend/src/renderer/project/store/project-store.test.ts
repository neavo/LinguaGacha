import { describe, expect, it, vi } from "vitest";

import { createProjectStore, createProjectStoreReplaceSectionPatch } from "./project-store";

describe("createProjectStore", () => {
  it("按 section 独立写入 bootstrap 阶段数据", () => {
    const store = createProjectStore();

    store.applyBootstrapStage("project", {
      project: { path: "E:/demo/demo.lg", loaded: true },
      revisions: { projectRevision: 1, sections: { project: 1 } },
    });
    store.applyBootstrapStage("items", {
      items: { total: 2 },
      revisions: { sections: { items: 3 } },
    });

    expect(store.getState().project.path).toBe("E:/demo/demo.lg");
    expect(store.getState().items.total).toBe(2);
    expect(store.getState().revisions.projectRevision).toBe(1);
    expect(store.getState().revisions.sections.items).toBe(3);
  });

  it("合并 project.patch 并推进受影响 section revision", () => {
    const store = createProjectStore();

    store.applyBootstrapStage("items", {
      items: {
        1: {
          item_id: 1,
          file_path: "chapter01.txt",
          src: "原文",
          dst: "旧译文",
          status: "PENDING",
        },
      },
      revisions: {
        projectRevision: 2,
        sections: {
          items: 2,
        },
      },
    });

    store.applyProjectPatch({
      source: "task",
      projectRevision: 3,
      updatedSections: ["items", "task"],
      patch: [
        {
          op: "merge_items",
          items: [
            {
              item_id: 1,
              file_path: "chapter01.txt",
              src: "原文",
              dst: "新译文",
              status: "DONE",
            },
          ],
        },
        {
          op: "replace_task",
          task: {
            task_type: "translation",
            status: "DONE",
            busy: false,
          },
        },
      ],
    });

    expect(store.getState().items["1"]).toEqual({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "原文",
      dst: "新译文",
      status: "DONE",
    });
    expect(store.getState().task).toEqual({
      task_type: "translation",
      status: "DONE",
      busy: false,
    });
    expect(store.getState().revisions.projectRevision).toBe(3);
    expect(store.getState().revisions.sections.items).toBe(3);
    expect(store.getState().revisions.sections.task).toBe(1);
  });

  it("批量应用 project.patch 时保持顺序且只通知一次 listener", () => {
    const store = createProjectStore();
    const listener = vi.fn();

    store.subscribe(listener);
    store.applyProjectPatchBatch([
      {
        source: "translation_batch",
        projectRevision: 2,
        updatedSections: ["items"],
        patch: [
          {
            op: "merge_items",
            items: [
              {
                item_id: 1,
                file_path: "chapter01.txt",
                dst: "第一版",
                status: "NONE",
              },
            ],
          },
        ],
      },
      {
        source: "translation_batch",
        projectRevision: 3,
        updatedSections: ["items"],
        patch: [
          {
            op: "merge_items",
            items: [
              {
                item_id: 1,
                file_path: "chapter01.txt",
                dst: "第二版",
                status: "PROCESSED",
              },
            ],
          },
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

  it("对缺省 projectRevision 的 project.patch 保留已有 revision", () => {
    const store = createProjectStore();

    store.applyBootstrapStage("items", {
      items: {
        1: {
          item_id: 1,
          file_path: "chapter01.txt",
          src: "原文",
          dst: "旧译文",
          status: "PENDING",
        },
      },
      revisions: {
        projectRevision: 5,
        sections: {
          items: 2,
        },
      },
    });

    store.applyProjectPatch({
      source: "translation_batch_update",
      projectRevision: 0,
      updatedSections: ["items"],
      patch: [
        {
          op: "merge_items",
          items: [
            {
              item_id: 1,
              file_path: "chapter01.txt",
              src: "原文",
              dst: "批次译文",
              status: "DONE",
            },
          ],
        },
      ],
    });

    expect(store.getState().items["1"]).toEqual({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "原文",
      dst: "批次译文",
      status: "DONE",
    });
    expect(store.getState().revisions.projectRevision).toBe(5);
    expect(store.getState().revisions.sections.items).toBe(3);
  });

  it("从 prompts 快照的 meta.enabled 归一化提示词启用态", () => {
    const store = createProjectStore();
    const bootstrap_prompts = {
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

    store.applyBootstrapStage("prompts", {
      prompts: bootstrap_prompts,
      revisions: {
        projectRevision: 7,
        sections: {
          prompts: 4,
        },
      },
    });

    store.applyProjectPatch({
      source: "quality_prompt_save",
      projectRevision: 8,
      updatedSections: ["prompts"],
      patch: [
        {
          op: "replace_prompts",
          prompts: patched_prompts,
        },
      ],
    });

    expect(store.getState().prompts.translation).toEqual({
      text: "新提示词",
      enabled: true,
      revision: 11,
    });
    expect(store.getState().revisions.projectRevision).toBe(8);
    expect(store.getState().revisions.sections.prompts).toBe(5);
  });

  it("精确 revision 模式允许本地 patch 回滚到旧 revision", () => {
    const store = createProjectStore();
    const bootstrap_quality = {
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

    store.applyBootstrapStage("quality", {
      quality: bootstrap_quality,
      revisions: {
        projectRevision: 4,
        sections: {
          quality: 2,
        },
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

    store.applyProjectPatch(
      {
        source: "quality_rule_save_entries",
        projectRevision: 5,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 3,
        },
        patch: [createProjectStoreReplaceSectionPatch("quality", optimistic_quality)],
      },
      {
        revisionMode: "exact",
      },
    );

    expect(store.getState().quality.glossary.revision).toBe(3);
    expect(store.getState().revisions.projectRevision).toBe(5);
    expect(store.getState().revisions.sections.quality).toBe(3);

    store.applyProjectPatch(
      {
        source: "quality_rule_save_entries_rollback",
        projectRevision: 4,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 2,
        },
        patch: [createProjectStoreReplaceSectionPatch("quality", bootstrap_quality)],
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

  it("服务器 patch 不会把本地合成 revision 压回去", () => {
    const store = createProjectStore();

    store.applyBootstrapStage("quality", {
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
      revisions: {
        projectRevision: 4,
        sections: {
          quality: 2,
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

    store.applyProjectPatch(
      {
        source: "quality_rule_save_entries",
        projectRevision: 5,
        updatedSections: ["quality"],
        sectionRevisions: {
          quality: 3,
        },
        patch: [createProjectStoreReplaceSectionPatch("quality", optimistic_quality)],
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

    store.applyProjectPatch({
      source: "quality_rule_save_entries_confirmed",
      projectRevision: 4,
      updatedSections: ["quality"],
      sectionRevisions: {
        quality: 2,
      },
      patch: [createProjectStoreReplaceSectionPatch("quality", server_quality)],
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

  it("revision 对齐后下一次本地 patch 会从对齐值继续递增", () => {
    const store = createProjectStore();

    store.applyBootstrapStage("analysis", {
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
      revisions: {
        projectRevision: 6,
        sections: {
          analysis: 4,
        },
      },
    });

    store.alignRevisions({
      projectRevision: 10,
      sectionRevisions: {
        analysis: 8,
      },
    });

    store.applyProjectPatch(
      {
        source: "analysis_reset_failed",
        projectRevision: 11,
        updatedSections: ["analysis"],
        patch: [
          createProjectStoreReplaceSectionPatch("analysis", {
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
