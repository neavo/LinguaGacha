import type { Server } from "node:http";
import type { Socket } from "node:net";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { ProjectDatabase } from "../database/database-operations";
import { ModelService } from "../model/model-service";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { ProjectSyncMutationService } from "../project/project-sync-mutation-service";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectResetPreviewService } from "../project/project-reset-preview-service";
import { ProjectPatchAdapter } from "../project/project-patch-adapter";
import { ProofreadingService } from "../service/proofreading-service";
import { QualityService } from "../service/quality-service";
import { AppPathService } from "../service/path-service";
import { ConfigService } from "../service/config-service";
import { FileExportService } from "../file/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import type { LogEvent } from "../log/log-types";
import { ProjectRuntimeEncoder, type BootstrapSseEvent } from "../project/project-runtime-encoder";
import { TaskDataService } from "../task/task-data-service";
import { TaskEventHub } from "../task/task-event-hub";
import { TaskRuntimeState } from "../task/task-runtime-state";
import { TaskService } from "../task/task-service";
import { TaskSnapshotBuilder } from "../task/task-snapshot-builder";
import { TaskEngine } from "../task-engine/task-engine";
import { TaskWorkerPool } from "../task-worker/task-worker-pool";
import { JsonTool } from "../../shared/utils/json-tool";
import {
  close_http_server_with_connections,
  track_http_server_connections,
} from "../server/http-server-connections";
import { api_error, ok, type ApiGatewayStartResult, type ApiJsonValue } from "./api-types";

// 公开 Gateway 只监听本机环回地址，避免局域网暴露桌面 API。
const CORE_API_HOST = "127.0.0.1";

// 日志流 keepalive 短间隔用于保持本机窗口实时性，不作为项目事件节奏。
const LOG_STREAM_KEEPALIVE_INTERVAL_MS = 500;

// 公开 Gateway 只接受 JSON 请求头，内部授权材料不进入 CORS 可读面。
const CORS_ALLOWED_HEADERS = "Content-Type";

/**
 * Gateway 启动参数由 Electron 生命周期层注入，路由层只消费不可变依赖。
 */
export interface ApiGatewayServerOptions {
  // appRoot 决定版本、预设和用户数据路径解析，不在路由层重新猜测。
  appRoot: string;
  // publicPort 由生命周期端口分配器保证唯一，Gateway 只按该端口监听。
  publicPort: number;
  // database 由生命周期层注入，Gateway 不负责创建或关闭 .lg 物理存储。
  database: ProjectDatabase;
  // logManager 是日志窗口、SSE 和内部提交层的唯一汇聚点。
  logManager: LogManager;
}

/**
 * 封装 Electron 公开 API Gateway 的路由和生命周期边界。
 */
export class ApiGatewayServer {
  private readonly options: ApiGatewayServerOptions;

  // 公开项目 loaded/path 由 Gateway 持有，避免 renderer 直接读取数据库状态。
  private readonly project_session_state = new ProjectSessionState();

  // 任务 busy / 请求中数量 / 重翻条目由 TS Gateway 维护，避免运行态分散。
  private readonly task_runtime_state = new TaskRuntimeState();

  // 事件 hub 持有本地订阅者，Gateway stop 时必须显式关闭。
  private event_hub: TaskEventHub | null = null;

  // server 只代表公开 Gateway 监听器，Core 与 Database 生命周期不归这里关闭。
  private server: Server | null = null;

  // task_worker_pool 持有 worker_threads，Gateway stop 时必须主动释放。
  private task_worker_pool: TaskWorkerPool | null = null;

  // 退出时 renderer SSE 仍可能保持连接，必须由 Gateway 主动切断。
  private readonly server_sockets = new Set<Socket>();

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
      return { baseUrl: this.base_url() };
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
      track_http_server_connections(pending_server, this.server_sockets);

      pending_server.once("error", handle_start_error);
    });
    this.server = server;
    return { baseUrl: this.base_url() };
  }

  /**
   * 只释放 Gateway 自己持有的监听器，Core 与 Database 生命周期由上层编排。
   */
  public async stop(): Promise<void> {
    this.event_hub?.stop();
    this.event_hub = null;
    await this.task_worker_pool?.dispose();
    this.task_worker_pool = null;
    const server = this.server;
    this.server = null;
    if (server === null) {
      return;
    }
    await close_http_server_with_connections(server, this.server_sockets);
  }

  /**
   * 公开 `/api/*` 协议在这里集中注册，避免 renderer 依赖内部实现端口。
   */
  private create_app(): Hono {
    const paths = new AppPathService({ appRoot: this.options.appRoot });
    const project_patch_adapter = new ProjectPatchAdapter(
      this.options.database,
      this.project_session_state,
    );
    const event_hub = new TaskEventHub({
      projectPatchAdapter: project_patch_adapter,
      taskRuntimeState: this.task_runtime_state,
    });
    this.event_hub = event_hub;
    event_hub.start();
    const config_service = new ConfigService(paths, event_hub);
    const model_service = new ModelService(paths, config_service);
    const project_lifecycle_service = new ProjectLifecycleService(
      this.options.database,
      this.project_session_state,
      config_service,
      paths,
      this.options.logManager,
    );
    const project_service = new ProjectSyncMutationService(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
    );
    const proofreading_service = new ProofreadingService(
      this.options.database,
      this.project_session_state,
    );
    const task_snapshot_builder = new TaskSnapshotBuilder(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
    );
    const project_runtime_service = new ProjectRuntimeEncoder(
      this.options.database,
      task_snapshot_builder,
      this.project_session_state,
    );
    const task_data_service = new TaskDataService(
      this.options.database,
      this.project_session_state,
      this.task_runtime_state,
      event_hub,
    );
    const executor_client = new TaskWorkerPool({
      appRoot: this.options.appRoot,
    });
    this.task_worker_pool = executor_client;
    const task_engine = new TaskEngine({
      taskDataService: task_data_service,
      taskRuntimeState: this.task_runtime_state,
      eventHub: event_hub,
      executorClient: executor_client,
      configService: config_service,
      snapshotBuilder: task_snapshot_builder,
      logManager: this.options.logManager,
    });
    const task_service = new TaskService(
      task_engine,
      task_snapshot_builder,
      this.task_runtime_state,
      this.project_session_state,
      config_service,
    );
    const project_reset_preview_service = new ProjectResetPreviewService(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
    );
    const file_preview_service = new FilePreviewService(config_service);
    const file_export_service = new FileExportService(
      this.options.database,
      config_service,
      this.project_session_state,
      this.options.logManager,
    );
    const quality_service = new QualityService(
      paths,
      config_service,
      this.options.database,
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
        }),
      );
    });

    app.get("/api/logs/stream", () => {
      return this.create_log_stream_response();
    });
    app.get("/api/events/stream", () => {
      return event_hub.create_stream_response();
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
    this.post_json(app, "/api/models/list-available", (body) =>
      model_service.list_available_models(body),
    );
    this.post_json(app, "/api/models/test", (body) => model_service.test_model(body));

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
    this.post_json(app, "/api/project/load", (body) =>
      project_lifecycle_service.load_project(body),
    );
    this.post_json(app, "/api/project/create-commit", (body) =>
      project_lifecycle_service.create_project_commit(body),
    );
    this.post_json(app, "/api/project/open-preview", (body) =>
      project_lifecycle_service.get_open_alignment_preview(body),
    );

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
    this.post_json(app, "/api/tasks/start-translation", (body) =>
      task_service.start_translation(body),
    );
    this.post_json(app, "/api/tasks/stop-translation", (body) =>
      task_service.stop_translation(body),
    );
    this.post_json(app, "/api/tasks/start-analysis", (body) => task_service.start_analysis(body));
    this.post_json(app, "/api/tasks/stop-analysis", (body) => task_service.stop_analysis(body));
    this.post_json(app, "/api/tasks/start-retranslate", (body) =>
      task_service.start_retranslate(body),
    );
    this.post_json(app, "/api/tasks/snapshot", (body) => task_service.get_task_snapshot(body));
    this.post_json(app, "/api/tasks/translate-single", (body) =>
      task_service.translate_single(body),
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

    app.all("*", (context) => {
      return context.json(api_error("not_found", "API 路由不存在。"), 404);
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
   * 内部异常只映射成稳定错误壳，调用方不需要理解 main 进程实现细节。
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
   * renderer 只认公开 Gateway 地址，内部服务地址不会透出到 preload 边界。
   */
  private base_url(): string {
    return `http://${CORE_API_HOST}:${this.options.publicPort.toString()}`;
  }

  /**
   * 公开日志流由 TS LogManager 直接提供，避免窗口依赖内部日志实现。
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
   * Gateway 自身异常统一打到 TS 日志源，便于和其他内部日志区分。
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
