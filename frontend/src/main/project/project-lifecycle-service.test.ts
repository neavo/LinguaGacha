import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { CoreBridgeClient, ProjectStatePayload } from "../core/core-bridge-client";
import { ProjectLifecycleService } from "./project-lifecycle-service";

describe("ProjectLifecycleService", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { force: true, recursive: true });
    }
  });

  it("snapshot 只暴露 Python 会话权威的加载态字段", async () => {
    const service = new ProjectLifecycleService(
      create_database(),
      create_core_bridge({
        loaded: true,
        projectPath: "E:/Project/demo.lg",
        busy: true,
      }),
    );

    await expect(service.get_project_snapshot()).resolves.toEqual({
      project: {
        path: "E:/Project/demo.lg",
        loaded: true,
      },
    });
  });

  it("source-files 按源路径顺序收集支持格式并去重", () => {
    const root = create_temp_dir();
    const source_a = path.join(root, "source-a");
    const source_b = path.join(root, "source-b");
    fs.mkdirSync(path.join(source_a, "nested"), { recursive: true });
    fs.mkdirSync(source_b, { recursive: true });
    const first_txt = write_file(path.join(source_a, "b.TXT"));
    const second_md = write_file(path.join(source_a, "nested", "a.md"));
    const ignored = write_file(path.join(source_a, "ignore.bin"));
    const third_json = write_file(path.join(source_b, "c.json"));
    const service = new ProjectLifecycleService(create_database(), create_core_bridge());

    const result = service.collect_source_files({
      source_paths: ["", source_a, first_txt, ignored, source_b, source_a],
    });

    expect(result).toEqual({
      source_files: [first_txt, second_md, third_json],
    });
  });

  it("preview 从 database summary 收窄为公开摘要载荷", () => {
    const project_path = write_file(path.join(create_temp_dir(), "demo.lg"));
    const database = create_database({
      name: "demo",
      source_language: "JA",
      target_language: "ZH",
      file_count: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      translation_stats: {
        total_items: 10,
        completed_count: 4,
        failed_count: 1,
        pending_count: 3,
        skipped_count: 2,
        completion_percent: 60,
      },
      hidden_field: "不会外泄",
    });
    const service = new ProjectLifecycleService(database, create_core_bridge());

    expect(service.get_project_preview({ path: project_path })).toEqual({
      preview: {
        path: project_path,
        name: "demo",
        source_language: "JA",
        target_language: "ZH",
        file_count: 2,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        translation_stats: {
          total_items: 10,
          completed_count: 4,
          failed_count: 1,
          pending_count: 3,
          skipped_count: 2,
          completion_percent: 60,
        },
      },
    });
    expect(database.execute).toHaveBeenCalledWith({
      name: "getProjectSummary",
      args: { projectPath: project_path },
    });
  });

  it("preview 在工程文件不存在时抛出 ENOENT", () => {
    const service = new ProjectLifecycleService(create_database(), create_core_bridge());

    expect(() =>
      service.get_project_preview({ path: path.join(create_temp_dir(), "missing.lg") }),
    ).toThrow("工程文件不存在");
  });

  it("unload 先触发 Python 真卸载再释放旧工程 database 缓存", async () => {
    const calls: string[] = [];
    const project_path = "E:/Project/demo.lg";
    const database = create_database(null, calls);
    const core_bridge = create_core_bridge(
      { loaded: true, projectPath: project_path, busy: false },
      calls,
    );
    const service = new ProjectLifecycleService(database, core_bridge);

    await expect(service.unload_project()).resolves.toEqual({
      project: {
        path: "",
        loaded: false,
      },
    });

    expect(calls).toEqual(["get_project_state", "unload_project", "closeProject"]);
    expect(database.execute).toHaveBeenCalledWith({
      name: "closeProject",
      args: { projectPath: project_path },
    });
  });

  it("unload 未加载时不释放 database 缓存", async () => {
    const database = create_database();
    const service = new ProjectLifecycleService(
      database,
      create_core_bridge({ loaded: false, projectPath: "", busy: false }),
    );

    await service.unload_project();

    expect(database.execute).not.toHaveBeenCalled();
  });

  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-lifecycle-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  function write_file(file_path: string): string {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, "demo", "utf-8");
    return file_path;
  }

  function create_database(summary: object | null = null, calls: string[] = []) {
    return {
      execute: vi.fn((operation: { name: string }) => {
        calls.push(operation.name);
        return summary;
      }),
    } as unknown as ProjectDatabase & { execute: ReturnType<typeof vi.fn> };
  }

  function create_core_bridge(
    state: ProjectStatePayload = {
      loaded: false,
      projectPath: "",
      busy: false,
    },
    calls: string[] = [],
  ) {
    return {
      get_project_state: vi.fn(async () => {
        calls.push("get_project_state");
        return state;
      }),
      unload_project: vi.fn(async () => {
        calls.push("unload_project");
      }),
    } as unknown as CoreBridgeClient;
  }
});
