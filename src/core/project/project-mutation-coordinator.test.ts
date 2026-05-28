import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { AppEventBus } from "../app/app-event-bus";
import { ProjectDatabase } from "../database/database-operations";
import type { ProjectChangePublisher } from "./project-change-publisher";
import { ProjectMutationCoordinator } from "./project-mutation-coordinator";
import type { ProjectChangeEvent } from "../../shared/project-event";

let temp_dir = "";

/**
 * 每个用例使用独立临时工程，避免 revision meta 互相污染
 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

/**
 * 创建只回显草稿的发布器，便于断言 coordinator 生成的 canonical payload
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
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-mutation-coordinator-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectMutationCoordinator", () => {
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
    const coordinator = new ProjectMutationCoordinator(database, null, new AppEventBus());

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
    const coordinator = new ProjectMutationCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new AppEventBus(),
    );
    const build_operations = vi.fn(() => []);

    await expect(
      coordinator.commit_project_mutation({
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
    const coordinator = new ProjectMutationCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new AppEventBus(),
    );

    const result = await coordinator.commit_project_mutation({
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
    const app_event_bus = new AppEventBus();
    app_event_bus.subscribe("project.items.changed", (event) => {
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
    const coordinator = new ProjectMutationCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      app_event_bus,
    );

    await coordinator.commit_project_mutation({
      projectPath: lg_path,
      expectedSectionRevisions: { items: 0 },
      sections: ["items"],
      buildOperations: (context) => coordinator.build_section_revision_operations(context),
      change: { source: "translation_reset", updatedSections: ["items"] },
    });

    expect(calls).toEqual(["internal:1", "public"]);
    database.close();
  });

  it("拒绝字符串、布尔值和小数 revision，避免旧兼容锁值进入写入口", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
    const coordinator = new ProjectMutationCoordinator(database, null, new AppEventBus());

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
    const coordinator = new ProjectMutationCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new AppEventBus(),
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
    const coordinator = new ProjectMutationCoordinator(
      database,
      publisher as unknown as ProjectChangePublisher,
      new AppEventBus(),
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
