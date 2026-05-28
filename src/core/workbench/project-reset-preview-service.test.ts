import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { ProjectResetPreviewService } from "./project-reset-preview-service";
import { ProjectSessionState } from "../project/project-session";

let temp_dir = "";
const cleanup_databases: ProjectDatabase[] = [];

/**
 * 每个用例创建独立 .lg 数据库和服务，避免状态串扰
 */
function create_service(): {
  database: ProjectDatabase;
  lg_path: string;
  service: ProjectResetPreviewService;
  task_runtime_state: TaskRuntimeState;
} {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  const task_runtime_state = new TaskRuntimeState();
  const session_state = new ProjectSessionState();
  const lg_path = path.join(temp_dir, "reset-preview.lg");
  database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
  session_state.mark_loaded(lg_path);
  const service = new ProjectResetPreviewService(database, task_runtime_state, session_state);
  return { database, lg_path, service, task_runtime_state };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-reset-preview-"));
});

afterEach(() => {
  while (cleanup_databases.length > 0) {
    cleanup_databases.pop()?.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectResetPreviewService", () => {
  it("翻译 all 预演通过 文件域重解析并保留当前 item id", async () => {
    const { database, lg_path, service } = create_service();
    database.execute({
      name: "addAssetFromSource",
      args: {
        projectPath: lg_path,
        path: "script.txt",
        sourcePath: write_source_file("script.txt"),
        sortOrder: 0,
      },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "旧", dst: "old", row: 0, file_path: "script.txt" }],
      },
    });

    const result = await service.preview_translation_reset({ mode: "all" });

    expect(result["items"]).toEqual([
      expect.objectContaining({
        id: 1,
        src: "demo",
        file_path: "script.txt",
      }),
    ]);
  });

  it("翻译 all 预演在文件顺序变化后仍按 file_path 和 row 保留 item id", async () => {
    const { database, lg_path, service } = create_service();
    database.execute({
      name: "addAssetFromSource",
      args: {
        projectPath: lg_path,
        path: "a.txt",
        sourcePath: write_source_file("a.txt", "alpha"),
        sortOrder: 1,
      },
    });
    database.execute({
      name: "addAssetFromSource",
      args: {
        projectPath: lg_path,
        path: "b.txt",
        sourcePath: write_source_file("b.txt", "beta"),
        sortOrder: 0,
      },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          { id: 1, src: "旧 A", dst: "old-a", row: 0, file_path: "a.txt" },
          { id: 2, src: "旧 B", dst: "old-b", row: 0, file_path: "b.txt" },
        ],
      },
    });

    const result = await service.preview_translation_reset({ mode: "all" });

    expect(result["items"]).toEqual([
      expect.objectContaining({ id: 2, src: "beta", file_path: "b.txt", row: 0 }),
      expect.objectContaining({ id: 1, src: "alpha", file_path: "a.txt", row: 0 }),
    ]);
  });

  it("分析 failed 预演按删除 ERROR checkpoint 后的摘要返回", async () => {
    const { database, lg_path, service } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          { id: 1, src: "A", status: "NONE" },
          { id: 2, src: "B", status: "NONE" },
          { id: 3, src: "C", status: "EXCLUDED" },
        ],
      },
    });
    database.execute({
      name: "upsertAnalysisItemCheckpoints",
      args: {
        projectPath: lg_path,
        checkpoints: [
          { item_id: 1, status: "PROCESSED" },
          { item_id: 2, status: "ERROR" },
        ],
      },
    });

    await expect(service.preview_analysis_reset({ mode: "failed" })).resolves.toEqual({
      status_summary: { total_line: 2, processed_line: 1, error_line: 0, line: 1 },
    });
  });
});

/**
 * 写入源文件并返回绝对路径，供数据库 asset 导入操作使用
 */
function write_source_file(file_name: string, content = "demo"): string {
  const file_path = path.join(temp_dir, file_name);
  fs.writeFileSync(file_path, content, "utf-8");
  return file_path;
}
