import crypto from "node:crypto";
import type { Server } from "node:http";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { ProjectDatabase } from "../database/database-operations";
import { ModelService } from "../service/model-service";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { ProjectSyncMutationService } from "../project/project-sync-mutation-service";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectResetPreviewService } from "../project/project-reset-preview-service";
import { ProjectPatchAdapter } from "../project/project-patch-adapter";
import { ProofreadingService } from "../service/proofreading-service";
import { QualityService } from "../service/quality-service";
import { CoreBridgeClient } from "../core/core-bridge-client";
import { AppPathService } from "../service/path-service";
import { ConfigService } from "../service/config-service";
import { FileExportService } from "../file/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import type { LogAppendPayload, LogEvent, LogLevel, LogTargets } from "../log/log-types";
import { ProjectRuntimeEncoder, type BootstrapSseEvent } from "../project/project-runtime-encoder";
import { JsonTool } from "../../utils/json-tool";
import { api_error, ok, type ApiGatewayStartResult, type ApiJsonValue } from "./api-types";

// 公开 Gateway 只监听本机环回地址，避免局域网暴露桌面 API。
const CORE_API_HOST = "127.0.0.1";

// 长期事件流经 TS 适配 project.patch，其它 frame 继续透传 Python。
const STREAM_PROXY_PATHS = new Set(["/api/events/stream"]);

// 日志流 keepalive 短间隔用于保持本机窗口实时性，不作为项目事件节奏。
const LOG_STREAM_KEEPALIVE_INTERVAL_MS = 500;

// Python 日志提交复用 Core token，避免公开日志入口被 renderer 随意写入。
const LOG_APPEND_TOKEN_HEADER_NAME = "X-LinguaGacha-Core-Token";
// CORS 允许头必须包含日志 token，否则 Python Core 无法通过 Gateway 写日志。
const CORS_ALLOWED_HEADERS = `Content-Type, ${LOG_APPEND_TOKEN_HEADER_NAME}`;

/**
 * Gateway 启动参数由 Electron 生命周期层注入，路由层只消费不可变依赖。
 */
export interface ApiGatewayServerOptions {
  // appRoot 决定版本、预设和用户数据路径解析，不在路由层重新猜测。
  appRoot: string;
  publicPort: number;
  // Python Core 地址与 token 只给 Gateway 代理和内部桥使用。
  pyCoreBaseUrl: string;
  pyCoreToken: string;
  // database 由生命周期层注入，Gateway 不负责创建或关闭 .lg 物理存储。
  database: ProjectDatabase;
  logManager: LogManager;
}

/**
 * 封装 Electron 公开 API Gateway 的路由、代理和生命周期边界。
 */
export class ApiGatewayServer {
  private readonly options: ApiGatewayServerOptions;

  // instance token 用来让 renderer 探活时识别当前 Gateway 实例，避免误连旧进程。
  private readonly instance_token = crypto.randomBytes(24).toString("hex");

  // 公开项目 loaded/path 由 Gateway 持有，Python 只保留任务和文件运行时状态。
  private readonly project_session_state = new ProjectSessionState();

  // server 只代表公开 Gateway 监听器，Core 与 Database 生命周期不归这里关闭。
  private server: Server | null = null;

  /**
   * Gateway 只接收已组装好的运行期依赖，避免路由层自行解析全局状态。
   */
  public constructor(options: ApiGatewayServerOptions) {
    this.options = options;
  }

  /**
   * 重复 start 返回同一入口，避免公开端口和实例 token 在运行期漂移。
   */
  public async start(): Promise<ApiGatewayStartResult> {
    if (this.server !== null) {
      return { baseUrl: this.base_url(), instanceToken: this.instance_token };
    }
    const app = this.create_app();
    const server = await new Promise<Server>((resolve, reject) => {
      let pending_server: Server;
      const handle_start_error = (error: Error): void => {
        pending_server.close();
        this.server = null;
        reject(error);
      };
      pending_server = serve(
        {
          fetch: app.fetch,
          hostname: CORE_API_HOST,
          port: this.options.publicPort,
        },
        () => {
          pending_server.off("error", handle_start_error);
          resolve(pending_server);
        },
      ) as Server;

      pending_server.once("error", handle_start_error);
    });
    this.server = server;
    return { baseUrl: this.base_url(), instanceToken: this.instance_token };
  }

  /**
   * 只释放 Gateway 自己持有的监听器，Core 与 Database 生命周期由上层编排。
   */
  public async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) {
      return;
    }
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

  /**
   * 公开 `/api/*` 协议在这里集中注册，避免 renderer 依赖 Python 内部端口。
   */
  private create_app(): Hono {
    const paths = new AppPathService({ appRoot: this.options.appRoot });
    const core_bridge = new CoreBridgeClient({
      pyCoreBaseUrl: this.options.pyCoreBaseUrl,
      pyCoreToken: this.options.pyCoreToken,
    });
    const config_service = new ConfigService(paths, core_bridge);
    const model_service = new ModelService(paths, config_service, core_bridge);
    const project_lifecycle_service = new ProjectLifecycleService(
      this.options.database,
      core_bridge,
      this.project_session_state,
    );
    const project_service = new ProjectSyncMutationService(
      this.options.database,
      core_bridge,
      this.project_session_state,
    );
    const proofreading_service = new ProofreadingService(
      this.options.database,
      core_bridge,
      this.project_session_state,
    );
    const project_runtime_service = new ProjectRuntimeEncoder(
      this.options.database,
      core_bridge,
      this.project_session_state,
    );
    const project_reset_preview_service = new ProjectResetPreviewService(
      this.options.database,
      core_bridge,
      this.project_session_state,
    );
    const file_preview_service = new FilePreviewService(config_service, core_bridge);
    const file_export_service = new FileExportService(
      this.options.database,
      config_service,
      this.project_session_state,
      core_bridge,
    );
    const project_patch_adapter = new ProjectPatchAdapter(
      this.options.database,
      this.project_session_state,
    );
    const quality_service = new QualityService(
      paths,
      config_service,
      this.options.database,
      core_bridge,
      this.project_session_state,
    );
    const app = new Hono();

    app.use("*", async (context, next) => {
      if (context.req.method === "OPTIONS") {
        return new Response(null, { headers: this.cors_headers(), status: 204 });
      }
      await next();
      context.header("Access-Control-Allow-Origin", "*");
      context.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      context.header("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
    });

    app.get("/api/health", (context) => {
      return context.json(
        ok({
          status: "ok",
          service: "linguagacha-core",
          version: paths.read_version(),
          instanceToken: this.instance_token,
        }),
      );
    });

    app.get("/api/logs/stream", () => {
      return this.create_log_stream_response();
    });
    app.get("/api/project/bootstrap/stream", async (context) => {
      try {
        const events = await project_runtime_service.build_bootstrap_events();
        return this.create_project_bootstrap_stream_response(events);
      } catch (error) {
        const envelope = this.error_to_envelope(error);
        if (envelope.error.code === "internal_error") {
          this.log_gateway_error("TS Gateway bootstrap 处理失败", error, {
            path: "/api/project/bootstrap/stream",
          });
        }
        return context.json(envelope, envelope.error.code === "invalid_request" ? 400 : 500);
      }
    });
    app.post("/api/logs/append", async (context) => {
      const token = context.req.header(LOG_APPEND_TOKEN_HEADER_NAME);
      if (token !== this.options.pyCoreToken) {
        return context.json(api_error("invalid_request", "日志提交 token 无效。"), 401);
      }
      try {
        const body = (await context.req.json().catch((error: unknown) => {
          throw new SyntaxError(error instanceof Error ? error.message : "JSON 无效。");
        })) as Record<string, ApiJsonValue>;
        this.options.logManager.append(this.parse_log_append_payload(body));
        return context.json(ok({ accepted: true }));
      } catch (error) {
        const envelope = this.error_to_envelope(error);
        if (envelope.error.code === "internal_error") {
          this.log_gateway_error("公开日志提交处理失败", error, {
            path: "/api/logs/append",
          });
        }
        return context.json(envelope, envelope.error.code === "invalid_request" ? 400 : 500);
      }
    });

    this.post_json(app, "/api/settings/app", () => config_service.get_app_settings());
    this.post_json(app, "/api/settings/update", (body) => config_service.update_app_settings(body));
    this.post_json(app, "/api/settings/recent-projects/add", (body) =>
      config_service.add_recent_project(body),
    );
    this.post_json(app, "/api/settings/recent-projects/remove", (body) =>
      config_service.remove_recent_project(body),
    );

    this.post_json(app, "/api/models/snapshot", () => model_service.get_snapshot());
    this.post_json(app, "/api/models/update", (body) => model_service.update_model(body));
    this.post_json(app, "/api/models/activate", (body) => model_service.activate_model(body));
    this.post_json(app, "/api/models/add", (body) => model_service.add_model(body));
    this.post_json(app, "/api/models/delete", (body) => model_service.delete_model(body));
    this.post_json(app, "/api/models/reset-preset", (body) =>
      model_service.reset_preset_model(body),
    );
    this.post_json(app, "/api/models/reorder", (body) => model_service.reorder_model(body));

    this.post_json(app, "/api/project/snapshot", () =>
      project_lifecycle_service.get_project_snapshot(),
    );
    this.post_json(app, "/api/project/unload", () => project_lifecycle_service.unload_project());
    this.post_json(app, "/api/project/preview", (body) =>
      project_lifecycle_service.get_project_preview(body),
    );
    this.post_json(app, "/api/project/source-files", (body) =>
      project_lifecycle_service.collect_source_files(body),
    );
    this.post_json(app, "/api/project/create-preview", (body) =>
      file_preview_service.build_create_preview(body),
    );
    this.post_json_proxy(app, "/api/project/load", (data) => {
      this.project_session_state.mark_loaded(this.extract_project_path(data));
    });
    this.post_json_proxy(app, "/api/project/create-commit", (data) => {
      this.project_session_state.mark_loaded(this.extract_project_path(data));
    });

    this.post_json(app, "/api/project/workbench/add-file", (body) =>
      project_service.add_workbench_file(body),
    );
    this.post_json(app, "/api/project/workbench/reset-file", (body) =>
      project_service.reset_workbench_file(body),
    );
    this.post_json(app, "/api/project/workbench/delete-file", (body) =>
      project_service.delete_workbench_file(body),
    );
    this.post_json(app, "/api/project/workbench/reorder-files", (body) =>
      project_service.reorder_workbench_files(body),
    );
    this.post_json(app, "/api/project/workbench/parse-file", (body) =>
      file_preview_service.parse_workbench_file(body),
    );
    this.post_json(app, "/api/project/settings-alignment/apply", (body) =>
      project_service.apply_settings_alignment(body),
    );
    this.post_json(app, "/api/project/translation/reset", (body) =>
      project_service.apply_translation_reset(body),
    );
    this.post_json(app, "/api/project/translation/reset-preview", (body) =>
      project_reset_preview_service.preview_translation_reset(body),
    );
    this.post_json(app, "/api/project/analysis/reset", (body) =>
      project_service.apply_analysis_reset(body),
    );
    this.post_json(app, "/api/project/analysis/reset-preview", (body) =>
      project_reset_preview_service.preview_analysis_reset(body),
    );
    this.post_json(app, "/api/project/analysis/import-glossary", (body) =>
      project_service.import_analysis_glossary(body),
    );
    this.post_json(app, "/api/project/proofreading/save-item", (body) =>
      proofreading_service.save_item(body),
    );
    this.post_json(app, "/api/project/proofreading/save-all", (body) =>
      proofreading_service.save_all(body),
    );
    this.post_json(app, "/api/project/proofreading/replace-all", (body) =>
      proofreading_service.replace_all(body),
    );
    this.post_json(app, "/api/project/export-converted-translation", (body) =>
      file_export_service.export_converted_translation(body),
    );
    this.post_json(app, "/api/tasks/export-translation", () =>
      file_export_service.export_translation(),
    );

    this.post_json(app, "/api/quality/rules/save-entries", (body) =>
      quality_service.save_rule_entries(body),
    );
    this.post_json(app, "/api/quality/rules/update-meta", (body) =>
      quality_service.update_rule_meta(body),
    );
    this.post_json(app, "/api/quality/rules/import", (body) => quality_service.import_rules(body));
    this.post_json(app, "/api/quality/rules/export", (body) => quality_service.export_rules(body));
    this.post_json(app, "/api/quality/rules/presets", (body) =>
      quality_service.list_rule_presets(body),
    );
    this.post_json(app, "/api/quality/rules/presets/read", (body) =>
      quality_service.read_rule_preset(body),
    );
    this.post_json(app, "/api/quality/rules/presets/save", (body) =>
      quality_service.save_rule_preset(body),
    );
    this.post_json(app, "/api/quality/rules/presets/rename", (body) =>
      quality_service.rename_rule_preset(body),
    );
    this.post_json(app, "/api/quality/rules/presets/delete", (body) =>
      quality_service.delete_rule_preset(body),
    );
    this.post_json(app, "/api/quality/prompts/template", (body) =>
      quality_service.get_prompt_template(body),
    );
    this.post_json(app, "/api/quality/prompts/save", (body) => quality_service.save_prompt(body));
    this.post_json(app, "/api/quality/prompts/import", (body) =>
      quality_service.read_prompt_import_text(body),
    );
    this.post_json(app, "/api/quality/prompts/export", (body) =>
      quality_service.export_prompt(body),
    );
    this.post_json(app, "/api/quality/prompts/presets", (body) =>
      quality_service.list_prompt_presets(body),
    );
    this.post_json(app, "/api/quality/prompts/presets/read", (body) =>
      quality_service.read_prompt_preset(body),
    );
    this.post_json(app, "/api/quality/prompts/presets/save", (body) =>
      quality_service.save_prompt_preset(body),
    );
    this.post_json(app, "/api/quality/prompts/presets/rename", (body) =>
      quality_service.rename_prompt_preset(body),
    );
    this.post_json(app, "/api/quality/prompts/presets/delete", (body) =>
      quality_service.delete_prompt_preset(body),
    );

    app.all("*", async (context) => {
      try {
        return await this.proxy_to_py_core(context.req.raw, project_patch_adapter);
      } catch (error) {
        const source_url = new URL(context.req.url);
        this.log_gateway_error("TS Gateway 代理 Python Core 失败", error, {
          method: context.req.method,
          path: source_url.pathname,
        });
        return context.json(api_error("internal_error", "Python Core 代理失败。"), 500);
      }
    });

    return app;
  }

  /**
   * TS 直处理路由复用同一响应壳，避免错误码和 CORS 语义在各路由发散。
   */
  private post_json(
    app: Hono,
    path_name: string,
    handler: (
      body: Record<string, ApiJsonValue>,
    ) => Record<string, ApiJsonValue> | Promise<Record<string, ApiJsonValue>>,
  ): void {
    app.post(path_name, async (context) => {
      try {
        const body = (await context.req.json().catch((error: unknown) => {
          throw new SyntaxError(error instanceof Error ? error.message : "JSON 无效。");
        })) as Record<string, ApiJsonValue>;
        const data = await handler(body);
        return context.json(ok(data));
      } catch (error) {
        const envelope = this.error_to_envelope(error);
        const status =
          envelope.error.code === "not_found"
            ? 404
            : envelope.error.code === "invalid_request"
              ? 400
              : 500;
        if (status >= 500) {
          this.log_gateway_error("TS Gateway 直接路由处理失败", error, { path: path_name });
        }
        return context.json(envelope, status);
      }
    });
  }

  /**
   * 已迁移状态包装路由仍调用 Python 业务实现，但成功后同步 TS 公开会话状态。
   */
  private post_json_proxy(
    app: Hono,
    path_name: string,
    on_success: (data: Record<string, ApiJsonValue>) => void,
  ): void {
    app.post(path_name, async (context) => {
      try {
        const response = await this.proxy_to_py_core(context.req.raw);
        if (!response.ok) {
          return response;
        }
        const envelope = (await response.json()) as {
          ok?: boolean;
          data?: Record<string, ApiJsonValue>;
        };
        if (envelope.ok === true) {
          on_success(envelope.data ?? {});
        }
        return context.json(envelope);
      } catch (error) {
        this.log_gateway_error("TS Gateway 包装 Python 路由失败", error, { path: path_name });
        return context.json(api_error("internal_error", "Python Core 代理失败。"), 500);
      }
    });
  }

  /**
   * 未迁移路由仍只暴露公开 Gateway 地址，Python 内部端口不进入前端协议。
   */
  private async proxy_to_py_core(
    request: Request,
    project_patch_adapter?: ProjectPatchAdapter,
  ): Promise<Response> {
    const source_url = new URL(request.url);
    const is_stream_proxy = STREAM_PROXY_PATHS.has(source_url.pathname);
    const target_url = `${this.options.pyCoreBaseUrl}${source_url.pathname}${source_url.search}`;
    const headers = new Headers(request.headers);
    headers.delete("host");
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const stream_abort_controller = is_stream_proxy ? new AbortController() : null;
    const abort_stream_proxy = (): void => {
      stream_abort_controller?.abort();
    };
    if (stream_abort_controller !== null) {
      if (request.signal.aborted) {
        stream_abort_controller.abort();
      } else {
        request.signal.addEventListener("abort", abort_stream_proxy, { once: true });
      }
    }
    const response = await fetch(target_url, {
      body,
      headers,
      method: request.method,
      signal: stream_abort_controller?.signal ?? request.signal,
    });
    const response_headers = new Headers(response.headers);
    response_headers.delete("content-length");
    response_headers.delete("transfer-encoding");
    for (const [key, value] of this.cors_headers()) {
      response_headers.set(key, value);
    }
    if (is_stream_proxy) {
      if (source_url.pathname === "/api/events/stream" && project_patch_adapter !== undefined) {
        return this.create_adapted_event_stream_response(
          response,
          response_headers,
          project_patch_adapter,
          abort_stream_proxy,
        );
      }
      return new Response(response.body, {
        headers: response_headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    return new Response(await response.arrayBuffer(), {
      headers: response_headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  /**
   * 事件流只改写 project.patch data，普通事件和 keepalive 原样透传。
   */
  private create_adapted_event_stream_response(
    response: Response,
    response_headers: Headers,
    project_patch_adapter: ProjectPatchAdapter,
    abort_upstream: () => void,
  ): Response {
    const source_body = response.body;
    if (source_body === null) {
      return new Response(null, {
        headers: response_headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        reader = source_body.getReader();
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) {
              break;
            }
            buffer += decoder.decode(result.value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              controller.enqueue(
                encoder.encode(this.adapt_sse_frame(frame, project_patch_adapter)),
              );
            }
          }
          if (cancelled) {
            return;
          }
          if (buffer !== "") {
            controller.enqueue(encoder.encode(this.adapt_sse_frame(buffer, project_patch_adapter)));
          }
          controller.close();
        } catch (error) {
          if (cancelled) {
            return;
          }
          controller.error(error);
        } finally {
          reader.releaseLock();
          reader = null;
        }
      },
      cancel: async () => {
        cancelled = true;
        await reader?.cancel().catch(() => undefined);
        abort_upstream();
      },
    });
    return new Response(stream, {
      headers: response_headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  /**
   * 只解析单个 SSE frame；解析失败时原样返回，避免坏 frame 中断整条事件流。
   */
  private adapt_sse_frame(frame: string, project_patch_adapter: ProjectPatchAdapter): string {
    const lines = frame.split(/\r?\n/);
    const event_line = lines.find((line) => line.startsWith("event:"));
    if (event_line?.slice("event:".length).trim() !== "project.patch") {
      return `${frame}\n\n`;
    }
    const data_lines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    try {
      const payload = JsonTool.parseStrict(data_lines.join("\n"));
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return `${frame}\n\n`;
      }
      const adapted = project_patch_adapter.adapt_project_patch(
        payload as Record<string, ApiJsonValue>,
      );
      return this.build_sse_frame("project.patch", adapted);
    } catch {
      return `${frame}\n\n`;
    }
  }

  /**
   * 内部异常只映射成稳定错误壳，调用方不需要理解 TS/Python 实现差异。
   */
  private error_to_envelope(error: unknown) {
    if (error instanceof SyntaxError) {
      return api_error("invalid_request", "请求 JSON 无效。");
    }
    if (error instanceof Error) {
      if ("code" in error && error.code === "ENOENT") {
        return api_error("not_found", error.message);
      }
      return api_error("invalid_request", error.message);
    }
    return api_error("internal_error", "Gateway 内部错误。");
  }

  /**
   * 集中 CORS 头，保持健康检查、代理和预检响应一致。
   */
  private cors_headers(): Headers {
    return new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
    });
  }

  /**
   * renderer 只认公开 Gateway 地址，内部 Core 地址不会透出到 preload 边界。
   */
  private base_url(): string {
    return `http://${CORE_API_HOST}:${this.options.publicPort.toString()}`;
  }

  /**
   * 公开日志流由 TS LogManager 直接提供，避免窗口再依赖 Python 内部 SSE。
   */
  private create_log_stream_response(): Response {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let keepalive_timer: ReturnType<typeof setInterval> | null = null;
    const close_stream = (): void => {
      if (keepalive_timer !== null) {
        clearInterval(keepalive_timer);
        keepalive_timer = null;
      }
      unsubscribe?.();
      unsubscribe = null;
    };
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const enqueue_text = (text: string): void => {
          controller.enqueue(encoder.encode(text));
        };
        unsubscribe = this.options.logManager.subscribe((event) => {
          enqueue_text(this.build_log_sse_frame(event));
        });
        keepalive_timer = setInterval(() => {
          enqueue_text(": keepalive\n\n");
        }, LOG_STREAM_KEEPALIVE_INTERVAL_MS);
      },
      cancel: () => {
        close_stream();
      },
    });
    return new Response(stream, {
      headers: {
        "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
      status: 200,
    });
  }

  /**
   * 日志 SSE frame 使用固定事件名，renderer 日志面板只需订阅 log.appended。
   */
  private build_log_sse_frame(event: LogEvent): string {
    return `event: log.appended\ndata: ${JSON.stringify(event)}\n\n`;
  }

  /**
   * bootstrap 是一次性 SSE，事件在写首帧前已构建完毕，避免半截成功流。
   */
  private create_project_bootstrap_stream_response(events: BootstrapSseEvent[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const event of events) {
          controller.enqueue(encoder.encode(this.build_sse_frame(event.event, event.data)));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
      status: 200,
    });
  }

  /**
   * SSE 序列化统一走严格 JSON，避免手写 data 行时出现不可解析负载。
   */
  private build_sse_frame(event_type: string, payload: Record<string, ApiJsonValue>): string {
    return `event: ${event_type}\ndata: ${JsonTool.stringifyStrict(payload)}\n\n`;
  }

  /**
   * 从 Python load/create 响应中提取项目路径，用于同步 TS 会话状态。
   */
  private extract_project_path(data: Record<string, ApiJsonValue>): string {
    const project = data["project"];
    if (typeof project !== "object" || project === null || Array.isArray(project)) {
      return "";
    }
    const path_value = (project as Record<string, ApiJsonValue>)["path"];
    return typeof path_value === "string" ? path_value : "";
  }

  /**
   * Python 日志提交 payload 在 Gateway 边界归一化，避免污染 TS LogManager。
   */
  private parse_log_append_payload(body: Record<string, ApiJsonValue>): LogAppendPayload {
    const message = typeof body["message"] === "string" ? body["message"] : "";
    const payload: LogAppendPayload = {
      level: this.parse_log_level(body["level"]),
      message,
      source: typeof body["source"] === "string" ? body["source"] : "python-core",
      targets: this.parse_log_targets(body["targets"]),
    };
    if (typeof body["error_message"] === "string") {
      payload.error_message = body["error_message"];
    }
    if (typeof body["stack"] === "string") {
      payload.stack = body["stack"];
    }
    if (
      typeof body["context"] === "object" &&
      body["context"] !== null &&
      !Array.isArray(body["context"])
    ) {
      payload.context = body["context"] as Record<string, unknown>;
    }
    return payload;
  }

  /**
   * 未知日志级别降级为 info，保证日志入口不会因旧 Core 字段失败。
   */
  private parse_log_level(value: ApiJsonValue | undefined): LogLevel {
    if (
      value === "debug" ||
      value === "info" ||
      value === "warning" ||
      value === "error" ||
      value === "fatal"
    ) {
      return value;
    }
    return "info";
  }

  /**
   * 日志输出目标只接受布尔字段，未知字段不会穿透到 LogManager。
   */
  private parse_log_targets(value: ApiJsonValue | undefined): Partial<LogTargets> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const raw_targets = value as Record<string, unknown>;
    const targets: Partial<LogTargets> = {};
    for (const key of ["file", "console", "window"] as const) {
      if (typeof raw_targets[key] === "boolean") {
        targets[key] = raw_targets[key];
      }
    }
    return targets;
  }

  /**
   * Gateway 自身异常统一打到 TS 日志源，便于和 Python Core 日志区分。
   */
  private log_gateway_error(
    message: string,
    error: unknown,
    context: Record<string, unknown>,
  ): void {
    this.options.logManager.error(message, {
      source: "ts-gateway",
      context,
      error_message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
