import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectSessionState } from "../project/project-session-state";
import { ProofreadingService } from "./proofreading-service";

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
  const publisher = { publish_project_change: vi.fn() };
  return {
    database,
    service: new ProofreadingService(
      database,
      session_state,
      publisher as unknown as ProjectChangePublisher,
    ),
    session_state,
    lg_path,
    publisher,
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
  it("保存单条校对结果时只合并白名单字段并同步 revision", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          {
            id: 1,
            file_path: "a.txt",
            row: 1,
            src: "旧原文",
            dst: "旧译文",
            name_dst: "保留姓名",
            status: "NONE",
            text_type: "dialogue",
            retry_count: 0,
          },
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
        },
      },
    });

    const ack = await service.save_item({
      items: [
        {
          id: "1",
          file_path: "b.txt",
          row_number: "5",
          src: "新原文",
          dst: "新译文",
          name_dst: "不应写入",
          status: "PROCESSED",
          text_type: "name",
          retry_count: "2",
        },
      ],
      translation_extras: { line: 9 },
      expected_section_revisions: { items: 2, proofreading: 3 },
    });

    expect(ack).toEqual({
      accepted: true,
      projectRevision: 4,
      sectionRevisions: { items: 3, proofreading: 4 },
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      {
        id: 1,
        file_path: "b.txt",
        row: 5,
        src: "新原文",
        dst: "新译文",
        name_dst: "保留姓名",
        status: "PROCESSED",
        text_type: "name",
        retry_count: 2,
      },
    ]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: {} },
      }),
    ).toEqual({ line: 9 });
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: [1],
      },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
  });

  it("空 items 或不存在的 item 只写 translation_extras 但仍推进双 revision", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "原文", dst: "旧译文", status: "PROCESSED" }],
      },
    });

    const ack = await service.save_all({
      items: [{ id: 404, dst: "不会创建" }],
      translation_extras: { batch: true },
    });

    expect(ack).toEqual({
      accepted: true,
      projectRevision: 1,
      sectionRevisions: { items: 1, proofreading: 1 },
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "原文", dst: "旧译文", status: "PROCESSED" },
    ]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: {} },
      }),
    ).toEqual({ batch: true });
  });

  it("items revision 冲突时拒绝写库且不触发 runtime sync", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setItems",
      args: { projectPath: lg_path, items: [{ id: 1, dst: "旧译文" }] },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 2 },
    });

    await expect(
      service.replace_all({
        items: [{ id: 1, dst: "新译文" }],
        translation_extras: {},
        expected_section_revisions: { items: 1 },
      }),
    ).rejects.toThrow("运行态 revision 冲突：section=items 当前=2 期望=1");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, dst: "旧译文" },
    ]);
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("proofreading revision 冲突时拒绝写库且保留旧 meta", async () => {
    const { database, service, lg_path, publisher } = create_service();
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "proofreading_revision.proofreading", value: 4 },
    });

    await expect(
      service.save_item({
        items: [],
        translation_extras: { line: 1 },
        expected_section_revisions: { proofreading: 3 },
      }),
    ).rejects.toThrow("校对 revision 冲突：当前=4，期望=3");

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
      name: "upsertMetaEntries",
      args: {
        projectPath: lg_path,
        meta: {
          "project_runtime_revision.items": -3,
          "proofreading_revision.proofreading": "bad",
        },
      },
    });

    const ack = await service.save_all({
      items: [],
      expected_section_revisions: { items: 0, proofreading: 0 },
    });

    expect(ack).toEqual({
      accepted: true,
      projectRevision: 1,
      sectionRevisions: { items: 1, proofreading: 1 },
    });
  });

  it("无法转换的 expected revision 会失败而不是归零", async () => {
    const { database, service, lg_path } = create_service();

    await expect(
      service.save_item({
        items: [],
        expected_section_revisions: { items: "not-a-number" },
      }),
    ).rejects.toThrow("整数值无效");

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
          { id: 1, src: "a", dst: "", status: "PROCESSED" },
          { id: 2, src: "b", dst: "", status: "PROCESSED" },
        ],
      },
    });

    await service.replace_all({
      items: [
        { item_id: 1, status: "BROKEN_STATUS" },
        { item_id: 2, status: "SOMETHING_NEW" },
      ],
    });

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "a", dst: "", status: "NONE" },
      { id: 2, src: "b", dst: "", status: "NONE" },
    ]);
  });

  it("工程未加载时拒绝校对保存", async () => {
    const { service, session_state } = create_service();
    session_state.clear();

    await expect(service.save_item({ items: [] })).rejects.toThrow("工程未加载");
  });
});
