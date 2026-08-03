import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { ProjectWriteStore } from "../project/project-write-store";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { get_section_revision } from "../project/project-data-reader";
import { ProjectSessionState } from "../project/project-session-state";
import { ProofreadingService } from "./proofreading-service";
import type { ProjectChangeEvent } from "../../shared/project-event";

let temp_dir = "";
const cleanup_databases: ProjectDatabase[] = [];

function project_path(name: string): string {
  return path.join(temp_dir, name);
}

function read_meta(
  database: ProjectDatabase,
  project_path: string,
  key: string,
  default_value: JsonValue,
): JsonValue {
  return (database.get_all_meta(project_path) as JsonRecord)[key] ?? default_value;
}

function create_service(task_busy = false): {
  database: ProjectDatabase;
  service: ProofreadingService;
  session_state: ProjectSessionState;
  lg_path: string;
  publisher: ReturnType<typeof create_test_project_change_publisher>;
  runtime_gate: RuntimeOperationGate;
} {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  const session_state = new ProjectSessionState();
  const lg_path = project_path("proofreading.lg");
  database.create_project(lg_path, "proofreading");
  session_state.mark_loaded(lg_path);
  const publisher = create_test_project_change_publisher(database, lg_path);
  const project_event_bus = vi.fn();
  const write_store = new ProjectWriteStore(
    database,
    project_event_bus,
    publisher.publish_project_change,
  );
  const runtime_gate = create_runtime_gate(task_busy);
  return {
    database,
    service: new ProofreadingService(database, runtime_gate, session_state, write_store),
    session_state,
    lg_path,
    publisher,
    runtime_gate,
  };
}

function create_runtime_gate(busy: boolean): RuntimeOperationGate {
  const gate = new RuntimeOperationGate();
  if (busy) gate.begin_runtime("task");
  return gate;
}

function create_test_project_change_publisher(database: ProjectDatabase, lg_path: string) {
  return {
    publish_project_change: vi.fn((payload: JsonRecord): ProjectChangeEvent => {
      const updated_sections = Array.isArray(payload.updatedSections)
        ? payload.updatedSections.map((section) => String(section))
        : [];
      const meta = database.get_all_meta(lg_path) as JsonRecord;
      const section_revisions = Object.fromEntries(
        updated_sections.map((section) => [section, get_section_revision(meta, section)]),
      );
      return {
        type: "project.changed",
        eventId: `test-${String(payload.source ?? "project_change")}`,
        source: String(payload.source ?? "project_change"),
        projectPath: String(payload.projectPath ?? ""),
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

function create_project_item(overrides: JsonRecord = {}): JsonRecord {
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
  it("任务 busy 时拒绝全部人工校对写入口", async () => {
    const { service } = create_service(true);

    for (const operation of [
      async () => await service.update_items({}),
      async () => await service.replace_all({}),
      async () => await service.clear_translations({}),
    ]) {
      await expect(operation()).rejects.toThrow("runtime.busy");
    }
  });

  it("Agent 校对写入口在自身租约内提交命令并由后端计算事实", async () => {
    const { database, service, lg_path, publisher, runtime_gate } = create_service();
    runtime_gate.begin_runtime("agent");
    database.set_items(lg_path, [
      create_project_item({
        src: "旧原文",
        dst: "旧译文",
        name_dst: "保留姓名",
        status: "NONE",
        text_type: "dialogue",
        retry_count: 7,
      }),
    ]);
    database.upsert_meta_entries(lg_path, {
      "project_runtime_revision.items": 2,
      "proofreading_revision.proofreading": 3,
      translation_extras: { total_tokens: 99, time: 5 },
    });

    const ack = await service.update_items_from_agent(
      {
        changes: [{ item_id: 1, dst: "新译文" }],
        expected_section_revisions: { items: 2, proofreading: 3 },
      },
      "agent_proofreading_update_items",
    );

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "agent_proofreading_update_items",
          projectRevision: 4,
          sectionRevisions: { items: 3, proofreading: 4 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        src: "旧原文",
        dst: "新译文",
        name_dst: "保留姓名",
        status: "PROCESSED",
        text_type: "dialogue",
        retry_count: 7,
      }),
    ]);
    expect(read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
      total_tokens: 99,
      time: 5,
      processed_line: 1,
      error_line: 0,
      total_line: 1,
      line: 1,
    });
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "agent_proofreading_update_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: [1],
      },
    });
  });

  it("相同非空译文仍会修正错误状态并同步翻译统计", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [
      create_project_item({ dst: "既有译文", status: "ERROR", retry_count: 2 }),
    ]);
    database.set_meta(lg_path, "translation_extras", {
      total_line: 1,
      processed_line: 0,
      error_line: 1,
      line: 1,
    });

    await service.update_items({
      changes: [{ item_id: 1, dst: "既有译文" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ dst: "既有译文", status: "PROCESSED", retry_count: 2 }),
    ]);
    expect(read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
      total_line: 1,
      processed_line: 1,
      error_line: 0,
      line: 1,
    });
  });

  it("多行不同译文字段原子提交并只发布一次 canonical delta", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({ id: 1, dst: "", status: "NONE" }),
      create_project_item({
        id: 2,
        dst: "正文",
        name_src: ["Alice", "Bob"],
        name_dst: ["旧名", "保留名"],
        status: "ERROR",
      }),
    ]);

    const result = await service.update_items({
      changes: [
        { item_id: 1, dst: "新译文" },
        { item_id: 2, name_dst: "新名" },
      ],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(result).toMatchObject({
      changes: [
        {
          source: "proofreading_update_items",
          sectionRevisions: { items: 1, proofreading: 1 },
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ id: 1, dst: "新译文", status: "PROCESSED" }),
      create_project_item({
        id: 2,
        dst: "正文",
        name_src: ["Alice", "Bob"],
        name_dst: ["新名", "保留名"],
        status: "ERROR",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledTimes(1);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "proofreading_update_items",
        items: { payloadMode: "canonical-delta", changedIds: [1, 2] },
      }),
    );
  });

  it("重复、越界、缺失 item 或非法字段整批拒绝且不发布事件", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [create_project_item({ id: 1, dst: "旧译文" })]);

    await expect(
      service.update_items({
        changes: [
          { item_id: 1, dst: "A" },
          { item_id: 1, name_dst: "B" },
        ],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.update_items({
        changes: [{ item_id: 1, dst: null }],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.update_items({
        changes: [{ item_id: Number.MAX_SAFE_INTEGER + 1, dst: "A" }],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.update_items({
        changes: [{ item_id: 1 }],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.update_items({
        changes: [{ item_id: 1, dst: "A", legacy: true }],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.update_items({
        changes: [
          { item_id: 1, dst: "A" },
          { item_id: 404, dst: "B" },
        ],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ id: 1, dst: "旧译文" }),
    ]);
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("只保存姓名译文时更新 name_dst 并保留正文状态", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        dst: "旧译文",
        name_src: "Alice",
        name_dst: "旧译名",
        status: "ERROR",
        retry_count: 2,
      }),
    ]);

    const ack = await service.update_items({
      changes: [{ item_id: 1, name_dst: "新译名" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_update_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "旧译文",
        name_src: "Alice",
        name_dst: "新译名",
        status: "ERROR",
        retry_count: 2,
      }),
    ]);
    expect(read_meta(database, lg_path, "translation_extras", null)).toBeNull();
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "proofreading_update_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: [1],
      },
    });
  });

  it("保存数组姓名译文时替换第 0 槽并保留后续姓名", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        dst: "旧译文",
        name_src: ["Alice", "Bob"],
        name_dst: ["旧译名", "保留译名"],
        status: "PROCESSED",
      }),
    ]);

    await service.update_items({
      changes: [{ item_id: 1, name_dst: "新译名" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "旧译文",
        name_src: ["Alice", "Bob"],
        name_dst: ["新译名", "保留译名"],
        status: "PROCESSED",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: { payloadMode: "canonical-delta", changedIds: [1] },
      }),
    );
  });

  it("保存前置空槽后的姓名译文时仍只替换第 0 槽", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        dst: "旧译文",
        name_src: ["", "Bob"],
        name_dst: ["", "旧译名"],
        status: "PROCESSED",
      }),
    ]);

    await service.update_items({
      changes: [{ item_id: 1, name_dst: "新译名" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "旧译文",
        name_src: ["", "Bob"],
        name_dst: ["新译名", "旧译名"],
        status: "PROCESSED",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: { payloadMode: "canonical-delta", changedIds: [1] },
      }),
    );
  });

  it("正文和姓名译文同次保存时发布同一个字段 patch", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        dst: "旧译文",
        name_dst: "旧译名",
        status: "NONE",
      }),
    ]);

    await service.update_items({
      changes: [{ item_id: 1, dst: "新译文", name_dst: "新译名" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "新译文",
        name_dst: "新译名",
        status: "PROCESSED",
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        items: { payloadMode: "canonical-delta", changedIds: [1] },
      }),
    );
  });

  it("替换全部同时处理正文译文和第 0 槽姓名译文", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        dst: "Name: Alice",
        name_src: ["Alice", "Bob"],
        name_dst: ["Name: Alice", "保留译名"],
        status: "NONE",
      }),
    ]);

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
          source: "proofreading_update_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "Alice",
        name_src: ["Alice", "Bob"],
        name_dst: ["Alice", "保留译名"],
        status: "PROCESSED",
      }),
    ]);
  });

  it("替换全部固定按大小写不敏感匹配", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [create_project_item({ dst: "Magic magic", status: "PROCESSED" })]);

    await service.replace_all({
      item_ids: [1],
      search_text: "Magic",
      replace_text: "魔法",
      is_regex: false,
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ dst: "魔法 魔法", status: "PROCESSED" }),
    ]);
  });

  it("替换全部能只更新第 0 槽姓名译文并保留正文状态", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        dst: "正文译文",
        name_src: "Alice",
        name_dst: "Name: Alice",
        status: "ERROR",
        retry_count: 2,
      }),
    ]);

    await service.replace_all({
      item_ids: [1],
      search_text: "Name: ",
      replace_text: "",
      is_regex: false,
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
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
    database.set_items(lg_path, [
      create_project_item({
        dst: "旧译文",
        name_src: ["Alice", "Bob"],
        name_dst: ["旧译名", "保留译名"],
        status: "PROCESSED",
        retry_count: 5,
      }),
    ]);

    const ack = await service.clear_translations({
      item_ids: [1],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_update_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "",
        name_src: ["Alice", "Bob"],
        name_dst: null,
        status: "PROCESSED",
        retry_count: 5,
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "proofreading_update_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: {
          dst: "",
          name_dst: null,
        },
      },
    });
  });

  it("正文译文已空但姓名译文非空时清空仍会写入", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [create_project_item({ dst: "", name_dst: ["", "保留译名"] })]);

    const ack = await service.clear_translations({
      item_ids: [1],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          items: {
            payloadMode: "field-patch",
            changedIds: [1],
            fieldPatch: { dst: "", name_dst: null },
          },
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ dst: "", name_dst: null }),
    ]);
  });

  it("统一 item 更新只改 status 时清除重试计数", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({ dst: "保留译文", status: "ERROR", retry_count: 4 }),
    ]);

    const ack = await service.update_items({
      changes: [{ item_id: 1, status: "PROCESSED" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_update_items",
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({
        dst: "保留译文",
        status: "PROCESSED",
        retry_count: 0,
      }),
    ]);
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "proofreading_update_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: [1],
      },
    });
  });

  it("显式 status 覆盖 dst 自动状态，菜单外状态整批拒绝", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [
      create_project_item({ dst: "保留译文", status: "ERROR", retry_count: 4 }),
    ]);

    await service.update_items({
      changes: [{ item_id: 1, dst: "新译文", status: "EXCLUDED" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ dst: "新译文", status: "EXCLUDED", retry_count: 0 }),
    ]);
    publisher.publish_project_change.mockClear();

    await expect(
      service.update_items({
        changes: [{ item_id: 1, status: "ERROR" }],
        expected_section_revisions: { items: 1, proofreading: 1 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ dst: "新译文", status: "EXCLUDED", retry_count: 0 }),
    ]);
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("不存在的清空译文 item 为 no-op 且不写计算 meta", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [create_project_item({ dst: "旧译文", status: "PROCESSED" })]);

    const ack = await service.clear_translations({
      item_ids: [404],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toEqual({ accepted: true, changes: [] });
    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ dst: "旧译文", status: "PROCESSED" }),
    ]);
    expect(read_meta(database, lg_path, "translation_extras", null)).toBeNull();
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("items revision 冲突时拒绝写库且不触发 state sync", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [create_project_item({ dst: "旧译文" })]);
    database.set_meta(lg_path, "project_runtime_revision.items", 2);

    await expect(
      service.replace_all({
        item_ids: [1],
        search_text: "旧",
        replace_text: "新",
        is_regex: false,
        expected_section_revisions: { items: 1, proofreading: 0 },
      }),
    ).rejects.toThrow("data.revision_conflict");

    expect(database.get_all_items(lg_path)).toEqual([create_project_item({ dst: "旧译文" })]);
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("proofreading revision 冲突时拒绝写库且保留旧 meta", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.set_items(lg_path, [create_project_item()]);
    database.set_meta(lg_path, "proofreading_revision.proofreading", 4);

    await expect(
      service.update_items({
        changes: [{ item_id: 1, dst: "新译文" }],
        expected_section_revisions: { items: 0, proofreading: 3 },
      }),
    ).rejects.toThrow("data.revision_conflict");

    expect(read_meta(database, lg_path, "translation_extras", null)).toBeNull();
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("坏值和负数 revision 按 0 读取并在成功后 bump 到 1", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [create_project_item()]);
    database.upsert_meta_entries(lg_path, {
      "project_runtime_revision.items": -3,
      "proofreading_revision.proofreading": "bad",
    });

    const ack = await service.update_items({
      changes: [{ item_id: 1, dst: "译文" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "proofreading_update_items",
          projectRevision: 1,
          sectionRevisions: { items: 1, proofreading: 1 },
          updatedSections: ["items", "proofreading"],
        },
      ],
    });
  });

  it("无法转换的 expected revision 会失败而不是归零", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [create_project_item()]);

    await expect(
      service.update_items({
        changes: [{ item_id: 1, dst: "译文" }],
        expected_section_revisions: { items: "not-a-number", proofreading: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(read_meta(database, lg_path, "project_runtime_revision.items", 0)).toBe(0);
  });

  it("未知 status 会归一为 NONE", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [
      create_project_item({
        id: 1,
        src: "a",
        dst: "旧译文",
        status: "BROKEN_STATUS",
      }),
    ]);

    await service.update_items({
      changes: [{ item_id: 1, dst: "" }],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_project_item({ id: 1, src: "a", dst: "", status: "NONE" }),
    ]);
  });

  it("project.not_loaded时拒绝校对保存", async () => {
    const { service, session_state } = create_service();
    session_state.clear();

    await expect(
      service.update_items({
        changes: [{ item_id: 1, dst: "译文" }],
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
    ).rejects.toThrow("project.not_loaded");
  });
});
