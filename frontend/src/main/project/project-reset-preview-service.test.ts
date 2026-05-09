import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { ProjectResetPreviewService } from "./project-reset-preview-service";
import { ProjectSessionState } from "./project-session-state";

let temp_dir = "";
const cleanup_databases: ProjectDatabase[] = [];

/**
 * reset preview 测试只需要 Core 的 busy 状态守卫。
 */
class FakeCoreBridge {
  // 测试直接切换 busy，验证 TS reset preview 的任务互斥守卫。
  public busy = false;

  /**
   * 返回最小项目状态，ProjectSessionState 才是公开 loaded/path 权威。
   */
  public async get_project_state(): Promise<{
    loaded: boolean;
    projectPath: string;
    busy: boolean;
  }> {
    return { loaded: true, projectPath: "", busy: this.busy };
  }
}

/**
 * 每个用例创建独立 .lg 数据库和服务，避免状态串扰。
 */
function create_service(): {
  bridge: FakeCoreBridge;
  database: ProjectDatabase;
  lg_path: string;
  service: ProjectResetPreviewService;
} {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  const bridge = new FakeCoreBridge();
  const session_state = new ProjectSessionState();
  const lg_path = path.join(temp_dir, "reset-preview.lg");
  database.execute({ name: "createProject", args: { projectPath: lg_path, name: "demo" } });
  session_state.mark_loaded(lg_path);
  const service = new ProjectResetPreviewService(database, bridge as never, session_state);
  return { bridge, database, lg_path, service };
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
  it("翻译 all 预演通过 TS 文件域重解析生成预览 id", async () => {
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

    const result = await service.preview_translation_reset({ mode: "all" });

    expect(result["items"]).toEqual([
      expect.objectContaining({
        id: 1,
        src: "demo",
        file_path: "script.txt",
      }),
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
 * 写入源文件并返回绝对路径，供数据库 asset 导入操作使用。
 */
function write_source_file(file_name: string): string {
  const file_path = path.join(temp_dir, file_name);
  fs.writeFileSync(file_path, "demo", "utf-8");
  return file_path;
}
