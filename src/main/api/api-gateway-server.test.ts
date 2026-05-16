import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectDatabase } from "../database/database-operations";
import { type FileLogWriter, LogManager } from "../log/log-manager";
import { ApiGatewayServer } from "./api-gateway-server";

describe("ApiGatewayServer", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = []; // Gateway 测试会启动真实本机 HTTP server，清理顺序必须由用例统一登记

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
  });

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
    expect(body.data?.service).toBe("linguagacha-core");
    expect(body.data?.version).toBe("9.8.7");
    expect(Object.keys(body.data ?? {})).not.toContain("instance" + "Token");
  });

  it("预检请求只暴露公开 CORS 头", async () => {
    const { gateway, database } = await create_gateway();
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/project/manifest`, {
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

  it("项目同步 mutation 由 API Gateway 直接处理", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    const lg_path = path.join(app_root, "direct-write.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "direct-write" },
    });

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/project/settings-alignment/apply`, {
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
    await post_json(started.baseUrl, "/api/project/load", { path: lg_path });
    const snapshot_response = await post_json(started.baseUrl, "/api/project/snapshot", {});
    const preview_response = await post_json(started.baseUrl, "/api/project/preview", {
      path: lg_path,
    });
    const source_files_response = await post_json(started.baseUrl, "/api/project/source-files", {
      source_paths: [source_dir],
    });
    const unload_response = await post_json(started.baseUrl, "/api/project/unload", {});
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
    const load_response = await post_json(started.baseUrl, "/api/project/load", { path: lg_path });
    const open_preview_response = await post_json(started.baseUrl, "/api/project/open-preview", {
      path: lg_path,
    });
    const create_commit_response = await post_json(started.baseUrl, "/api/project/create-commit", {
      source_paths: [source_path],
      path: path.join(app_root, "created-by-ts.lg"),
      draft: {
        files: [{ rel_path: "source.txt", source_path, sort_index: 0 }],
        items: [{ id: 1, file_path: "source.txt", src: "原文", status: "NONE" }],
      },
      project_settings: { source_language: "JA", target_language: "ZH" },
      translation_extras: {},
      prefilter_config: {},
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
    const response = await post_json(started.baseUrl, "/api/project/preview", {
      path: path.join(app_root, "missing.lg"),
    });
    const body = (await response.json()) as { ok?: boolean; error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("project.not_found");
  });

  it("校对同步 mutation 由 API Gateway 直接写库", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "proofreading-direct-write.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "proofreading-direct-write" },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "原文", dst: "", status: "NONE" }],
      },
    });

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/project/load", { path: lg_path });
    const response = await post_json(started.baseUrl, "/api/project/proofreading/save-item", {
      items: [{ id: 1, dst: "译文", status: "PROCESSED" }],
      translation_extras: { line: 1 },
      expected_section_revisions: { items: 0, proofreading: 0 },
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean; sectionRevisions?: Record<string, number> };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.accepted).toBe(true);
    expect(body.data?.sectionRevisions).toEqual({ items: 1, proofreading: 1 });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "原文", dst: "译文", status: "PROCESSED" },
    ]);
  });

  it("由 LogManager 直接提供公开日志流", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    log_manager.info("启动完成", { source: "test" });
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
    expect(text).toContain('"message":"启动完成"');
  });

  it("由 API Gateway 直接提供项目数据读取接口", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "project-read-direct.lg");
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
          items: [{ id: 1, file_path: "a.txt", row: 1, src: "原文", status: "NONE" }],
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
    await post_json(started.baseUrl, "/api/project/load", { path: lg_path });
    const manifest_response = await post_json(started.baseUrl, "/api/project/manifest", {});
    const manifest_body = (await manifest_response.json()) as {
      ok?: boolean;
      data?: {
        projectRevision?: number;
        sectionRevisions?: Record<string, number>;
      };
    };
    const sections_response = await post_json(started.baseUrl, "/api/project/read-sections", {
      sections: ["project", "items", "prompts"],
    });
    const sections_body = (await sections_response.json()) as {
      ok?: boolean;
      data?: {
        sections?: {
          items?: Record<string, { src?: string }>;
          prompts?: { translation?: { text?: string } };
        };
      };
    };

    expect(manifest_body.ok).toBe(true);
    expect(manifest_body.data?.projectRevision).toBeGreaterThanOrEqual(1);
    expect(manifest_body.data?.sectionRevisions).toMatchObject({
      prompts: 1,
    });
    expect(sections_body.ok).toBe(true);
    expect(sections_body.data?.sections?.items?.["1"]).toMatchObject({
      src: "原文",
    });
    expect(sections_body.data?.sections?.prompts?.translation?.text).toBe("\uD800");
  });

  it("按 item id 补读只接受当前工程正整数并去重", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "read-items-by-id.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "read-items-by-id" },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          { id: 2, file_path: "a.txt", row: 1, src: "二号原文", status: "NONE" },
          { id: 4, file_path: "b.txt", row: 2, src: "四号原文", status: "PROCESSED" },
        ],
      },
    });

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/project/load", { path: lg_path });
    const response = await post_json(started.baseUrl, "/api/project/items/read-by-ids", {
      itemIds: [2, "2", 4, 0, -1, "bad", 99],
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: {
        items?: Record<string, { src?: string }>;
        missingIds?: number[];
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.items).toMatchObject({
      "2": { src: "二号原文" },
      "4": { src: "四号原文" },
    });
    expect(Object.keys(body.data?.items ?? {})).toEqual(["2", "4"]);
    expect(body.data?.missingIds).toEqual([99]);
  });

  it("按 item id 补读在工程未加载时拒绝读取任意路径", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "unloaded-read-items.lg");
    const gateway = await create_gateway_with_database(app_root, database);
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "unloaded-read-items" },
    });

    const started = await gateway.start();
    const response = await post_json(started.baseUrl, "/api/project/items/read-by-ids", {
      itemIds: [1],
      path: lg_path,
    });
    const body = (await response.json()) as { ok?: boolean; error?: { code?: string } };

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("project.not_loaded");
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
      status: "requested",
      busy: true,
    });
  });

  it("生成译文路由使用 generate-translation 且旧路由不保留兼容入口", async () => {
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
          {
            id: 1,
            src: "原文",
            dst: "译文",
            status: "PROCESSED",
            file_type: "TXT",
            file_path: "script.txt",
            row: 0,
          },
        ],
      },
    });

    const started = await gateway.start();
    await post_json(started.baseUrl, "/api/project/load", { path: lg_path });
    const generate_response = await post_json(
      started.baseUrl,
      "/api/tasks/generate-translation",
      {},
    );
    const legacy_response = await post_json(started.baseUrl, "/api/tasks/export-translation", {});
    const generate_body = (await generate_response.json()) as {
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
    expect(legacy_response.status).toBe(404);
    expect(legacy_body.error?.code).toBe("request.route_not_found");
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
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      openOutputFolder: noop_output_folder,
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
    return new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      openOutputFolder: noop_output_folder,
      publicPort: await allocate_gateway_test_port(),
    });
  }

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
