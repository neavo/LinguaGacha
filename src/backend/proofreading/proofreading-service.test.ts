import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectEventBus } from "../project/project-events";
import { ProjectDatabase } from "../database/database-operations";
import type { ApiJsonValue } from "../api/api-types";
import type { ProjectChangePublisher } from "../project/project-changes";
import { ProjectWriteStore } from "../project/project-write-store";
import { get_section_revision } from "../project/project-data";
import { ProjectSessionState } from "../project/project-session";
import { ProofreadingService } from "./proofreading-service";
import type { ProjectChangeEvent } from "../../shared/project-event";

let temp_dir = "";
const cleanup_databases: ProjectDatabase[] = [];

function project_path(name: string): string {
  return path.join(temp_dir, name);
}

function create_service(): {
  database: ProjectDatabase;
  service: ProofreadingService;
  session_state: ProjectSessionState;
  lg_path: string;
  publisher: { publish_project_change: ReturnType<typeof vi.fn> };
} {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  const session_state = new ProjectSessionState();
  const lg_path = project_path("proofreading.lg");
  database.execute({
    name: "createProject",
    args: { projectPath: lg_path, name: "proofreading" },
  });
  session_state.mark_loaded(lg_path);
  const publisher = create_test_project_change_publisher(database, lg_path);
  const project_event_bus = new ProjectEventBus();
  const write_store = new ProjectWriteStore(
    database,
    project_event_bus,
    publisher as unknown as ProjectChangePublisher,
  );
  return {
    database,
    service: new ProofreadingService(database, session_state, write_store),
    session_state,
    lg_path,
    publisher,
  };
}

function create_test_project_change_publisher(
  database: ProjectDatabase,
  lg_path: string,
): { publish_project_change: ReturnType<typeof vi.fn> } {
  return {
    publish_project_change: vi.fn((payload: Record<string, ApiJsonValue>): ProjectChangeEvent => {
      const updated_sections = Array.isArray(payload.updatedSections)
        ? payload.updatedSections.map((section) => String(section))
        : [];
      const meta = database.execute({
        name: "getAllMeta",
        args: { projectPath: lg_path },
      }) as Record<string, ApiJsonValue>;
      const section_revisions = Object.fromEntries(
        updated_sections.map((section) => [section, get_section_revision(meta, section)]),
      );
      return {
        type: "project.changed",
        eventId: `test-${String(payload.source ?? "project_change")}`,
        source: String(payload.source ?? "project_change"),
        projectPath: String(payload.targetProjectPath ?? ""),
        projectRevision: Math.max(...Object.values(section_revisions), 0),
        sectionRevisions: section_revisions,
        updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
        ...(payload.items === undefined
          ? {}
          : { items: payload.items as ProjectChangeEvent["items"] }),
        ...(payload.sections === undefined
          ? {}
          : { sections: payload.sections as ProjectChangeEvent["sections"] }),
      };
    }),
  };
}

function create_project_item(
  overrides: Record<string, ApiJsonValue> = {},
): Record<string, ApiJsonValue> {
  return {
    id: 1,
    file_path: "a.txt",
    row: 0,
    src: "原文",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    file_type: "TXT",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-proofreading-service-"));
});

afterEach(() => {
  while (cleanup_databases.length > 0) {
    cleanup_databases.pop()?.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProofreadingService", () => {
  it("保存单条校对结果时只提交命令并由后端计算事实", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            src: "旧原文",
            dst: "旧译文",
            name_dst: "保留姓名",
            status: "NONE",
            text_type: "dialogue",
            retry_count: 7,
          }),
        ],
      },
    });
    database.execute({
      name: "upsertMetaEntries",
      args: {
        projectPath: lg_path,
        meta: {
          "project_runtime_revision.items": 2,
          "proofreading_revision.proofreading": 3,
          translation_extras: { total_tokens: 99, time: 5 },
        },
      },
    });

    const ack = await service.save_item({
      item_id: 1,
      dst: "新译文",
      expected_section_revisions: { items: 2, proofreading: 3 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_save_items",
          projectRevision: 4,
          sectionRevisions: { items: 3, proofreading: 4 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        src: "旧原文",
        dst: "新译文",
        name_dst: "保留姓名",
        status: "PROCESSED",
        text_type: "dialogue",
        retry_count: 7,
      }),
    ]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: {} },
      }),
    ).toMatchObject({
      total_tokens: 99,
      time: 5,
      processed_line: 1,
      error_line: 0,
      total_line: 1,
      line: 1,
    });
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: {
          dst: "新译文",
          status: "PROCESSED",
        },
      },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
  });

  it("只保存姓名译文时更新 name_dst 并保留正文状态", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "旧译文",
            name_src: "Alice",
            name_dst: "旧译名",
            status: "ERROR",
            retry_count: 2,
          }),
        ],
      },
    });

    const ack = await service.save_item({
      item_id: 1,
      name_dst: "新译名",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_save_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "旧译文",
        name_src: "Alice",
        name_dst: "新译名",
        status: "ERROR",
        retry_count: 2,
      }),
    ]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: null },
      }),
    ).toBeNull();
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: {
          name_dst: "新译名",
        },
      },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
  });

  it("保存数组姓名译文时替换第 0 槽并保留后续姓名", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "旧译文",
            name_src: ["Alice", "Bob"],
            name_dst: ["旧译名", "保留译名"],
            status: "PROCESSED",
          }),
        ],
      },
    });

    await service.save_item({
      item_id: 1,
      name_dst: "新译名",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "旧译文",
        name_src: ["Alice", "Bob"],
        name_dst: ["新译名", "保留译名"],
        status: "PROCESSED",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({
          fieldPatch: {
            name_dst: ["新译名", "保留译名"],
          },
        }),
      }),
    );
  });

  it("保存前置空槽后的姓名译文时仍只替换第 0 槽", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "旧译文",
            name_src: ["", "Bob"],
            name_dst: ["", "旧译名"],
            status: "PROCESSED",
          }),
        ],
      },
    });

    await service.save_item({
      item_id: 1,
      name_dst: "新译名",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "旧译文",
        name_src: ["", "Bob"],
        name_dst: ["新译名", "旧译名"],
        status: "PROCESSED",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({
          fieldPatch: {
            name_dst: ["新译名", "旧译名"],
          },
        }),
      }),
    );
  });

  it("正文和姓名译文同次保存时发布同一个字段 patch", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "旧译文",
            name_dst: "旧译名",
            status: "NONE",
          }),
        ],
      },
    });

    await service.save_item({
      item_id: 1,
      dst: "新译文",
      name_dst: "新译名",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "新译文",
        name_dst: "新译名",
        status: "PROCESSED",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({
          fieldPatch: {
            dst: "新译文",
            name_dst: "新译名",
            status: "PROCESSED",
          },
        }),
      }),
    );
  });

  it("替换全部同时处理正文译文和第 0 槽姓名译文", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "Name: Alice",
            name_src: ["Alice", "Bob"],
            name_dst: ["Name: Alice", "保留译名"],
            status: "NONE",
          }),
        ],
      },
    });

    const ack = await service.replace_all({
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_save_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "Alice",
        name_src: ["Alice", "Bob"],
        name_dst: ["Alice", "保留译名"],
        status: "PROCESSED",
      }),
    ]);
  });

  it("替换全部能只更新第 0 槽姓名译文并保留正文状态", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "正文译文",
            name_src: "Alice",
            name_dst: "Name: Alice",
            status: "ERROR",
            retry_count: 2,
          }),
        ],
      },
    });

    await service.replace_all({
      item_ids: [1],
      search_text: "Name: ",
      replace_text: "",
      is_regex: false,
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "正文译文",
        name_src: "Alice",
        name_dst: "Alice",
        status: "ERROR",
        retry_count: 2,
      }),
    ]);
  });

  it("清空译文同时清空姓名译文并保留状态和重试计数", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            dst: "旧译文",
            name_src: ["Alice", "Bob"],
            name_dst: ["旧译名", "保留译名"],
            status: "PROCESSED",
            retry_count: 5,
          }),
        ],
      },
    });

    const ack = await service.clear_translations({
      item_ids: [1],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_save_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({
        dst: "",
        name_src: ["Alice", "Bob"],
        name_dst: null,
        status: "PROCESSED",
        retry_count: 5,
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: {
          dst: "",
          name_dst: null,
        },
      },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
  });

  it("正文译文已空但姓名译文非空时清空仍会写入", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_project_item({ dst: "", name_dst: ["", "保留译名"] })],
      },
    });

    await service.clear_translations({
      item_ids: [1],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({ dst: "", name_dst: null }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({
          fieldPatch: {
            dst: "",
            name_dst: null,
          },
        }),
      }),
    );
  });

  it("设置翻译状态只改 status 并清除重试计数", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_project_item({ dst: "保留译文", status: "ERROR", retry_count: 4 })],
      },
    });

    const ack = await service.set_translation_status({
      item_ids: [1],
      status: "PROCESSED",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_save_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({ dst: "保留译文", status: "PROCESSED", retry_count: 0 }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: {
          status: "PROCESSED",
          retry_count: 0,
        },
      },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
  });

  it("设置翻译状态拒绝菜单外的计算状态", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_project_item({ dst: "保留译文", status: "ERROR", retry_count: 4 })],
      },
    });

    await expect(
      service.set_translation_status({
        item_ids: [1],
        status: "ERROR",
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({ dst: "保留译文", status: "ERROR", retry_count: 4 }),
    ]);
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("不存在的清空译文 item 为 no-op 且不写计算 meta", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_project_item({ dst: "旧译文", status: "PROCESSED" })],
      },
    });

    const ack = await service.clear_translations({
      item_ids: [404],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toEqual({ accepted: true, changes: [] });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({ dst: "旧译文", status: "PROCESSED" }),
    ]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: null },
      }),
    ).toBeNull();
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("items revision 冲突时拒绝写库且不触发 state sync", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: { projectPath: lg_path, items: [create_project_item({ dst: "旧译文" })] },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 2 },
    });

    await expect(
      service.replace_all({
        item_ids: [1],
        search_text: "旧",
        replace_text: "新",
        is_regex: false,
        expected_section_revisions: { items: 1, proofreading: 0 },
      }),
    ).rejects.toThrow("data.revision_conflict");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({ dst: "旧译文" }),
    ]);
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("proofreading revision 冲突时拒绝写库且保留旧 meta", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: { projectPath: lg_path, items: [create_project_item()] },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "proofreading_revision.proofreading", value: 4 },
    });

    await expect(
      service.save_item({
        item_id: 1,
        dst: "新译文",
        expected_section_revisions: { items: 0, proofreading: 3 },
      }),
    ).rejects.toThrow("data.revision_conflict");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: null },
      }),
    ).toBeNull();
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("坏值和负数 revision 按 0 读取并在成功后 bump 到 1", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: { projectPath: lg_path, items: [create_project_item()] },
    });
    database.execute({
      name: "upsertMetaEntries",
      args: {
        projectPath: lg_path,
        meta: {
          "project_runtime_revision.items": -3,
          "proofreading_revision.proofreading": "bad",
        },
      },
    });

    const ack = await service.save_item({
      item_id: 1,
      dst: "译文",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_save_items",
          projectRevision: 1,
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
  });

  it("无法转换的 expected revision 会失败而不是归零", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: { projectPath: lg_path, items: [create_project_item()] },
    });

    await expect(
      service.save_item({
        item_id: 1,
        dst: "译文",
        expected_section_revisions: { items: "not-a-number", proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "project_runtime_revision.items", default: 0 },
      }),
    ).toBe(0);
  });

  it("未知 status 会归一为 NONE", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            id: 1,
            src: "a",
            dst: "旧译文",
            status: "BROKEN_STATUS",
          }),
        ],
      },
    });

    await service.save_item({
      item_id: 1,
      dst: "",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_project_item({ id: 1, src: "a", dst: "", status: "NONE" }),
    ]);
  });

  it("project.not_loaded时拒绝校对保存", async () => {
    const { service, session_state } = create_service();
    session_state.clear();

    await expect(
      service.save_item({
        item_id: 1,
        dst: "译文",
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("project.not_loaded");
  });
});
