import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonTool } from "../../shared/utils/json-tool";
import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { BackendServices } from "../bootstrap/backend-services";
import { ProjectDatabase } from "../database/database-operations";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import { type FileLogWriter, LogManager } from "../log/log-manager";
import { ApiGatewayServer } from "./api-gateway-server";

const IN_PROCESS_WORKER_EXECUTION: BackendWorkerExecution = { kind: "in_process" }; // Gateway 测试只验证 HTTP 协议，不依赖真实 worker_threads

describe("ApiGatewayServer", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = []; // Gateway 测试会启动真实本机 HTTP server，清理顺序必须由用例统一登记

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
  });

  function create_project_item(
    overrides: Partial<Record<string, string | number | boolean | null>>,
  ): Record<string, string | number | boolean | null> {
    const id = Number(overrides["id"] ?? 1);
    return {
      id,
      src: "",
      dst: "",
      name_src: null,
      name_dst: null,
      extra_field: "",
      tag: "",
      row: id,
      file_type: "TXT",
      file_path: "",
      text_type: "NONE",
      status: "NONE",
      retry_count: 0,
      skip_internal_filter: false,
      ...overrides,
    };
  }

  it("由 API Gateway 响应公开健康检查", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/health`);
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { service?: string; version?: string };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.service).toBe("linguagacha-backend");
    expect(body.data?.version).toBe("9.8.7");
    expect(Object.keys(body.data ?? {})).not.toContain("instance" + "Token");
  });

  it("预检请求只暴露公开 CORS 头", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/session/project/manifest`, {
      headers: { "Access-Control-Request-Headers": "X-Private-Header" },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST,OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  it("未知 JSON 路由不再代理并返回稳定 request.route_not_found", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/proxy-target`, {
      body: JsonTool.stringifyStrict({ value: 7 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as { ok?: boolean; error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("request.route_not_found");
  });

  it("JSON 解析失败返回稳定 request.invalid_json 和 request_id", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/settings/app`, {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; request_id?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("request.invalid_json");
    expect(body.error?.request_id).toMatch(/[0-9a-f-]{36}/u);
  });

  it("项目同步 write 由 API Gateway 直接处理", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    const lg_path = path.join(app_root, "sync-write.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "sync-write" },
    });

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/workbench/settings-alignment/apply`, {
      body: JsonTool.stringifyStrict({
        mode: "settings_only",
        path: lg_path,
        project_settings: { source_language: "JA", target_language: "ZH" },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.accepted).toBe(true);
  });

  it("项目轻生命周期路由由 API Gateway 直接处理", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "project-lifecycle.lg");
    const source_dir = path.join(app_root, "source");
    fs.mkdirSync(source_dir, { recursive: true });
    fs.writeFileSync(path.join(source_dir, "script.txt"), "原文", "utf-8");
    fs.writeFileSync(path.join(source_dir, "ignored.bin"), "bin", "utf-8");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "project-lifecycle" },
    });
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/session/project/open", { path: lg_path });
    const snapshot_response = await post_json(started.baseUrl, "/api/session/project/snapshot", {});
    const preview_response = await post_json(started.baseUrl, "/api/session/project/preview", {
      path: lg_path,
    });
    const source_files_response = await post_json(
      started.baseUrl,
      "/api/session/source-files/collect",
      {
        source_paths: [source_dir],
      },
    );
    const unload_response = await post_json(started.baseUrl, "/api/session/project/close", {});
    const snapshot_body = (await snapshot_response.json()) as {
      data?: { project?: { path?: string; loaded?: boolean } };
    };
    const preview_body = (await preview_response.json()) as {
      data?: { preview?: { path?: string; name?: string } };
    };
    const source_files_body = (await source_files_response.json()) as {
      data?: { source_files?: string[] };
    };
    const unload_body = (await unload_response.json()) as {
      data?: { project?: { path?: string; loaded?: boolean } };
    };

    expect(snapshot_body.data?.project).toEqual({ path: lg_path, loaded: true });
    expect(preview_body.data?.preview?.path).toBe(lg_path);
    expect(preview_body.data?.preview?.name).toBe("project-lifecycle");
    expect(source_files_body.data?.source_files).toEqual([path.join(source_dir, "script.txt")]);
    expect(unload_body.data?.project).toEqual({ path: "", loaded: false });
  });

  it("项目生命周期创建与预览路由保持公开响应壳稳定", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "api-project-route.lg");
    const source_path = path.join(app_root, "source.txt");
    fs.writeFileSync(source_path, "原文", "utf-8");
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "route" } });
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const load_response = await post_json(started.baseUrl, "/api/session/project/open", {
      path: lg_path,
    });
    const open_preview_response = await post_json(
      started.baseUrl,
      "/api/session/project/open-preview",
      {
        path: lg_path,
      },
    );
    const create_commit_response = await post_json(started.baseUrl, "/api/session/project/create", {
      source_paths: [source_path],
      path: path.join(app_root, "created-by-ts.lg"),
      project_settings: { source_language: "ZH", target_language: "ZH" },
    });
    const load_body = (await load_response.json()) as { ok?: boolean };
    const open_preview_body = (await open_preview_response.json()) as { ok?: boolean };
    const create_commit_body = (await create_commit_response.json()) as { ok?: boolean };

    expect(load_body.ok).toBe(true);
    expect(open_preview_body.ok).toBe(true);
    expect(create_commit_body.ok).toBe(true);
  });

  it("项目 preview 缺失文件时映射为 project.not_found", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await post_json(started.baseUrl, "/api/session/project/preview", {
      path: path.join(app_root, "missing.lg"),
    });
    const body = (await response.json()) as { ok?: boolean; error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("project.not_found");
  });

  it("校对同步 write 由 API Gateway 直接写库", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "proofreading-sync-write.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "proofreading-sync-write" },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_project_item({ id: 1, src: "原文", dst: "" })],
      },
    });

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/session/project/open", { path: lg_path });
    const response = await post_json(started.baseUrl, "/api/proofreading/item/save", {
      item_id: 1,
      dst: "译文",
      expected_section_revisions: { items: 0, proofreading: 0 },
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: {
        accepted?: boolean;
        changes?: Array<{ sectionRevisions?: Record<string, number> }>;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.accepted).toBe(true);
    expect(body.data?.changes?.[0]?.sectionRevisions).toEqual({ items: 1, proofreading: 1 });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toMatchObject(
      [{ id: 1, src: "原文", dst: "译文", status: "PROCESSED" }],
    );
  });

  it("由 LogManager 提供轻量日志流和按需详情", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const full_message = `启动完成\n${"完整详情".repeat(400)}\n详情尾部`;
    log_manager.info(full_message, { source: "test" });
    const gateway = await create_gateway_with_database(app_root, database, log_manager);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const controller = new AbortController();
    const response = await fetch(`${started.baseUrl}/api/logs/stream`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("日志流响应体为空。");
    }
    const chunk = await reader.read();
    controller.abort();

    const text = new TextDecoder().decode(chunk.value);
    expect(response.status).toBe(200);
    expect(text).toContain("event: log.appended");
    expect(text).toContain('"message_preview"');
    expect(text).toContain('"source":"test"');
    expect(text).not.toContain('"message":"');
    expect(text).not.toContain("详情尾部");

    const detail_response = await fetch(`${started.baseUrl}/api/logs/detail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "log-1" }),
    });
    const detail_body = (await detail_response.json()) as {
      data?: { detail?: { message?: string; source?: string } };
    };

    expect(detail_response.status).toBe(200);
    expect(detail_body.data?.detail).toMatchObject({
      message: full_message,
      source: "test",
    });
  });

  it("接收 renderer 异常诊断并写入统一日志", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = await create_gateway_with_database(app_root, database, log_manager);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await post_json(started.baseUrl, "/api/diagnostics/renderer-error", {
      source: "scheduler",
      error: {
        name: "InternalInvariantError",
        message: "缺少完整 item DTO",
        stack: "Error: 缺少完整 item DTO\n    at applyProjectChangeBatch",
      },
      route: "workbench",
      triggeringEvent: {
        topic: "project.data_changed",
        updatedSections: ["items"],
        projectRevision: 12,
      },
    });

    const body = (await response.json()) as { ok?: boolean };
    const [event] = log_manager.snapshot_events();
    const detail = event === undefined ? null : log_manager.read_detail(event.id);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(event).toMatchObject({
      level: "error",
      source: "renderer",
    });
    expect(detail).toMatchObject({
      error: {
        name: "InternalInvariantError",
        message: "缺少完整 item DTO",
        stack: "Error: 缺少完整 item DTO\n    at applyProjectChangeBatch",
        context: {
          renderer_source: "scheduler",
          route: "workbench",
          triggeringEvent: {
            topic: "project.data_changed",
            updatedSections: ["items"],
            projectRevision: 12,
          },
        },
      },
    });
  });

  it("由 API Gateway 直接提供项目轻量 manifest 和页面 query 接口", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "project-read-api.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "project-read" },
    });
    database.execute_transaction([
      {
        name: "setItems",
        args: {
          projectPath: lg_path,
          items: [
            create_project_item({
              id: 1,
              file_path: "a.txt",
              row: 1,
              src: "原文",
              name_src: "魔法师",
            }),
          ],
        },
      },
      {
        name: "setRuleText",
        args: { projectPath: lg_path, ruleType: "translation_prompt", text: "\uD800" },
      },
      {
        name: "setMeta",
        args: { projectPath: lg_path, key: "quality_prompt_revision.translation", value: 1 },
      },
    ]);

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/session/project/open", { path: lg_path });
    const manifest_response = await post_json(started.baseUrl, "/api/session/project/manifest", {});
    const manifest_body = (await manifest_response.json()) as {
      ok?: boolean;
      data?: {
        projectPath?: string;
        projectRevision?: number;
        sectionRevisions?: Record<string, number>;
      };
    };
    const proofreading_response = await post_json(started.baseUrl, "/api/proofreading/view", {
      action: "items_by_row_ids",
      row_ids: ["1"],
    });
    const proofreading_body = (await proofreading_response.json()) as {
      ok?: boolean;
      data?: {
        projectPath?: string;
        rows?: Array<{ src?: string }>;
      };
    };
    const prompt_response = await post_json(started.baseUrl, "/api/quality/prompts/view", {
      task_type: "translation",
    });
    const prompt_body = (await prompt_response.json()) as {
      ok?: boolean;
      data?: {
        projectPath?: string;
        prompt?: { text?: string };
      };
    };

    expect(manifest_body.ok).toBe(true);
    expect(manifest_body.data?.projectPath).toBe(lg_path);
    expect(manifest_body.data?.projectRevision).toBeGreaterThanOrEqual(1);
    expect(manifest_body.data?.sectionRevisions).toMatchObject({
      prompts: 1,
    });
    expect(proofreading_body.ok).toBe(true);
    expect(proofreading_body.data?.projectPath).toBe(lg_path);
    expect(proofreading_body.data?.rows?.[0]).toMatchObject({
      src: "原文",
    });
    expect(prompt_body.ok).toBe(true);
    expect(prompt_body.data?.projectPath).toBe(lg_path);
    expect(prompt_body.data?.prompt?.text).toBe("\uD800");
  });

  it("analysis 候选读取路由只绑定当前 loaded 工程并返回完整候选池", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "analysis-candidates.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "analysis-candidates" },
    });
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
          {
            src: "魔法",
            dst_votes: { magic: 2 },
            info_votes: { 术语: 1 },
            observation_count: 2,
            first_seen_at: "2026-01-01T00:00:00.000Z",
            last_seen_at: "2026-01-02T00:00:00.000Z",
            case_sensitive: false,
          },
        ],
      },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "analysis_candidate_count", value: 1 },
    });

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/session/project/open", { path: lg_path });
    const response = await post_json(started.baseUrl, "/api/analysis/candidates/list", {});
    const body = (await response.json()) as {
      ok?: boolean;
      data?: {
        projectPath?: string;
        candidate_count?: number;
        candidate_aggregate?: Record<string, { dst_votes?: Record<string, number> }>;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.projectPath).toBe(lg_path);
    expect(body.data?.candidate_count).toBe(1);
    expect(body.data?.candidate_aggregate?.["魔法"]?.dst_votes).toEqual({ magic: 2 });
  });

  it("公开任务路由由 API Gateway 直处理", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await post_json(started.baseUrl, "/api/tasks/start", {
      task_type: "translation",
      mode: "new",
      scope: { kind: "all" },
      expected_section_revisions: { quality: 0, prompts: 0 },
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean; task?: { task_type?: string; status?: string; busy?: boolean } };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.accepted).toBe(true);
    expect(body.data?.task).toMatchObject({
      task_type: "translation",
    });
    expect(["requested", "running", "done"]).toContain(body.data?.task?.status);
    expect(body.data?.task?.busy).toBe(body.data?.task?.status !== "done");
  });

  it("译文文件导出路由使用 translation 域且旧路由不保留兼容入口", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "generate-route.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "generate-route" },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_project_item({
            id: 1,
            src: "原文",
            dst: "译文",
            status: "PROCESSED",
            file_type: "TXT",
            file_path: "script.txt",
            row: 0,
          }),
        ],
      },
    });

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/session/project/open", { path: lg_path });
    const generate_response = await post_json(started.baseUrl, "/api/translation/files/export", {});
    const ts_conversion_response = await post_json(
      started.baseUrl,
      "/api/toolbox/ts-conversion/files/export",
      { direction: "s2t" },
    );
    const legacy_response = await post_json(started.baseUrl, "/api/tasks/generate-translation", {});
    const generate_body = (await generate_response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean; output_path?: string };
    };
    const ts_conversion_body = (await ts_conversion_response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean; output_path?: string };
    };
    const legacy_body = (await legacy_response.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };

    expect(generate_body.ok).toBe(true);
    expect(generate_body.data).toEqual({
      accepted: true,
      output_path: path.join(app_root, "generate-route_译文"),
    });
    expect(fs.existsSync(path.join(app_root, "generate-route_译文", "script.txt"))).toBe(true);
    expect(ts_conversion_body.ok).toBe(true);
    expect(ts_conversion_body.data).toEqual({
      accepted: true,
      output_path: path.join(app_root, "generate-route_译文_S2T"),
    });
    expect(fs.existsSync(path.join(app_root, "generate-route_译文_S2T", "script.txt"))).toBe(true);
    expect(legacy_response.status).toBe(404);
    expect(legacy_body.error?.code).toBe("request.route_not_found");
  });

  it("旧 project 业务路径不保留兼容入口", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const legacy_paths = [
      "/api/project/export-converted-translation",
      "/api/project/query/workbench",
      "/api/project/proofreading/save-item",
      "/api/analysis/name-fields/view",
      "/api/translation/files/export-ts-conversion",
      "/api/toolbox/name-" + "fields/view",
      "/api/tasks/translate-" + "single",
    ];

    for (const legacy_path of legacy_paths) {
      const response = await post_json(started.baseUrl, legacy_path, {});
      const body = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string };
      };

      expect(response.status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("request.route_not_found");
    }
  });

  it("长期事件流由事件 hub 提供 keepalive 并在 Gateway 退出时关闭", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const stream = await read_http_stream_until(
      `${started.baseUrl}/api/events/stream`,
      "keepalive",
    );

    expect(stream.status).toBe(200);
    expect(stream.text).toContain(": keepalive");
    await expect(gateway.stop()).resolves.toBeUndefined();
  });

  it("Gateway stop 只释放公开监听器，不越界释放 BackendServices", async () => {
    const dispose = vi.fn(async () => undefined);
    const gateway = new ApiGatewayServer({
      backendServices: { dispose } as unknown as BackendServices,
      publicPort: 0,
    });

    await gateway.stop();

    expect(dispose).not.toHaveBeenCalled();
  });

  it("公开端口监听失败时拒绝启动并保持 stop 幂等", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const occupied_server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      occupied_server.once("error", reject);
      occupied_server.listen(0, "127.0.0.1", () => {
        occupied_server.off("error", reject);
        resolve();
      });
    });
    cleanup_callbacks.push(() => close_node_server(occupied_server));
    cleanup_callbacks.push(() => database.close());
    const address = occupied_server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("测试占用端口未取得地址。");
    }
    const paths = new AppPathService({ appRoot: app_root });
    const backend_services = new BackendServices({
      paths,
      metadata: new AppMetadataService(paths),
      appSettingService: new AppSettingService(paths),
      database,
      logManager: log_manager,
      systemProxySnapshot: null,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    backend_services.start();
    const gateway = new ApiGatewayServer({
      backendServices: backend_services,
      publicPort: address.port,
    });

    await expect(gateway.start()).rejects.toThrow();
    await expect(gateway.stop()).resolves.toBeUndefined();
  });

  /**
   * 创建默认 Gateway 三件套，让常规用例不用重复布置生命周期依赖
   */
  async function create_gateway(): Promise<{
    appRoot: string;
    database: ProjectDatabase;
    gateway: ApiGatewayServer;
  }> {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const gateway = await create_gateway_with_database(app_root, database);
    return { appRoot: app_root, database, gateway };
  }

  /**
   * 按指定 database 构造 Gateway，方便项目写库前后共享同一实例
   */
  async function create_gateway_with_database(
    app_root: string,
    database: ProjectDatabase,
    log_manager: LogManager = create_log_manager(app_root),
  ): Promise<ApiGatewayServer> {
    const paths = new AppPathService({ appRoot: app_root });
    const backend_services = new BackendServices({
      paths,
      metadata: new AppMetadataService(paths),
      appSettingService: new AppSettingService(paths),
      database,
      logManager: log_manager,
      systemProxySnapshot: null,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    backend_services.start();
    return new ApiGatewayServer({
      backendServices: backend_services,
      publicPort: await allocate_gateway_test_port(),
    });
  }

  // noop_output_folder 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  async function noop_output_folder(_output_path: string): Promise<void> {}

  /**
   * 临时 appRoot 提供 version 和资源根，避免测试污染真实用户目录
   */
  function create_app_root(): string {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-gateway-test-"));
    fs.writeFileSync(path.join(app_root, "version.txt"), "9.8.7", "utf-8");
    cleanup_callbacks.push(() => fs.rmSync(app_root, { force: true, recursive: true }));
    return app_root;
  }

  /**
   * 测试使用 OS 分配的本机端口，避免随机高位端口在 Windows 上命中保留范围
   */
  async function allocate_gateway_test_port(): Promise<number> {
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    await close_node_server(server);
    if (typeof address !== "object" || address === null) {
      throw new Error("测试端口未取得地址。");
    }
    return address.port;
  }

  /**
   * 使用内存 writer 避免 Gateway 测试把日志落到真实用户目录
   */
  function create_log_manager(app_root: string): LogManager {
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      fileWriter: create_memory_file_writer(),
      logDir: path.join(app_root, "log"),
    });
    cleanup_callbacks.push(() => log_manager.shutdown());
    return log_manager;
  }

  /**
   * fake writer 只验证 LogManager 路由行为，不关心文件系统刷新细节
   */
  function create_memory_file_writer(): FileLogWriter {
    return {
      write: () => undefined,
      flush: () => undefined,
      flushSync: () => undefined,
      end: (callback?: () => void) => {
        callback?.();
      },
    };
  }

  /**
   * POST JSON helper 固定请求壳，让用例只表达业务路径和 payload
   */
  async function post_json(
    base_url: string,
    path_name: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return await fetch(`${base_url}${path_name}`, {
      body: JsonTool.stringifyStrict(body),
      headers: { "Content-Type": "application/json", ...headers },
      method: "POST",
    });
  }

  /**
   * 用 Node HTTP 客户端读取公开 SSE，读到目标片段后销毁请求来模拟 renderer 断开
   */
  async function read_http_stream_until(
    url: string,
    expected_text: string,
  ): Promise<{ status: number; text: string }> {
    return await new Promise<{ status: number; text: string }>((resolve, reject) => {
      let settled = false;
      let text = "";
      const request = http.get(url, (response) => {
        const status = response.statusCode ?? 0;
        response.setEncoding("utf-8");
        response.on("data", (chunk: string) => {
          text += chunk;
          if (!settled && text.includes(expected_text)) {
            settled = true;
            clearTimeout(timeout_id);
            request.destroy();
            resolve({ status, text });
          }
        });
        response.on("end", () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout_id);
          reject(new Error(`事件流未收到 ${expected_text}。`));
        });
      });
      const timeout_id = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        request.destroy();
        reject(new Error(`事件流未收到 ${expected_text}。`));
      }, 1000);
      request.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout_id);
        reject(error);
      });
    });
  }

  /**
   * Node server close 需要 promise 化，确保端口释放后再启动下一段测试
   */
  async function close_node_server(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});
