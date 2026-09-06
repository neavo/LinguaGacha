import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { ProjectResetPreviewService } from "./project-reset-preview-service";
import { ProjectSessionState } from "./project-session-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";

let temp_dir = "";
const cleanup_databases: ProjectDatabase[] = [];

/**
 * 每个用例创建独立 .lg 数据库和服务，避免状态串扰
 */
function create_service(): {
  database: ProjectDatabase;
  lg_path: string;
  service: ProjectResetPreviewService;
} {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  const session_state = new ProjectSessionState();
  const lg_path = path.join(temp_dir, "reset-preview.lg");
  database.create_project(lg_path, "demo");
  session_state.mark_loaded(lg_path);
  const service = new ProjectResetPreviewService(
    database,
    new RuntimeOperationGate(),
    session_state,
  );
  return { database, lg_path, service };
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
    database.add_asset_from_source(lg_path, "script.txt", write_source_file("script.txt"), 0);
    database.set_items(lg_path, [
      { id: 1, src: "旧", dst: "old", row: 0, file_path: "script.txt" },
    ]);

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
    database.add_asset_from_source(lg_path, "a.txt", write_source_file("a.txt", "alpha"), 1);
    database.add_asset_from_source(lg_path, "b.txt", write_source_file("b.txt", "beta"), 0);
    database.set_items(lg_path, [
      { id: 1, src: "旧 A", dst: "old-a", row: 0, file_path: "a.txt" },
      { id: 2, src: "旧 B", dst: "old-b", row: 0, file_path: "b.txt" },
    ]);

    const result = await service.preview_translation_reset({ mode: "all" });

    expect(result["items"]).toEqual([
      expect.objectContaining({ id: 2, src: "beta", file_path: "b.txt", row: 0 }),
      expect.objectContaining({ id: 1, src: "alpha", file_path: "a.txt", row: 0 }),
    ]);
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
