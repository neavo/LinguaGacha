import crypto from "node:crypto";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { ProjectDatabase } from "../database/database-operations";
import { ModelService } from "../model/model-service";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { ProjectSyncMutationService } from "../project/project-sync-mutation-service";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectResetPreviewService } from "../project/project-reset-preview-service";
import { ProjectChangeEventAdapter } from "../project/project-change-event-adapter";
import { ProjectRuntimeProjectionService } from "../project/project-runtime-projection-service";
import { ProofreadingService } from "../service/proofreading-service";
import { QualityService } from "../service/quality-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { AppMetadataService } from "../app/app-metadata-service";
import { FileExportService } from "../file/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import { record_app_error } from "../log/app-error-reporter";
import type { LogEvent } from "../../shared/log";
import { CoreEventHub } from "../events/core-event-hub";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { TaskService } from "../service/task-service";
import { TaskEngine } from "../engine/core/engine";
import { create_o200k_base_token_counter } from "../engine/core/token-counter";
import { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { ProjectTaskStore } from "../engine/store/project-task-store";
import { WorkerPool } from "../engine/worker/worker-pool";
import { normalizeProjectDataSections } from "../../shared/project/event";
import {
  close_api_gateway_with_connections,
  track_api_gateway_connections,
} from "./api-gateway-connections";
import {
  FileNotFoundError,
  InternalInvariantError,
  InvalidJsonError,
  ProjectNotLoadedError,
  RouteNotFoundError,
  is_app_error,
  resolve_app_error_http_status,
  to_api_error_payload,
  type AppError,
  type AppErrorPublicDetails,
} from "../../shared/error";
import { api_error, ok, type ApiGatewayStartResult, type ApiJsonValue } from "./api-types";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";

const CORE_API_HOST = "127.0.0.1"; // 公开 Gateway 只监听本机环回地址，避免局域网暴露桌面 API

const LOG_STREAM_KEEPALIVE_INTERVAL_MS = 500; // 日志流 keepalive 短间隔用于保持本机窗口实时性，不作为项目事件节奏

const CORS_ALLOWED_HEADERS = "Content-Type"; // 公开 Gateway 只接受 JSON 请求头，避免 renderer 依赖额外私有请求头

/**
 * Gateway 启动参数由 Electron 生命周期层注入，路由层只消费不可变依赖
 */
export interface ApiGatewayServerOptions {
  paths: AppPathService; // paths 是生命周期层解析后的应用路径权威，Gateway 不重新猜测 appRoot
  metadata: AppMetadataService; // metadata 提供应用版本和 User-Agent 等只读元信息
  appSettingService: AppSettingService; // appSettingService 是 config.json 的运行期唯一写入口
  publicPort: number; // publicPort 由生命周期端口分配器保证唯一，Gateway 只按该端口监听
  database: ProjectDatabase; // database 由生命周期层注入，Gateway 不负责创建或关闭 .lg 物理存储
  logManager: LogManager; // logManager 是日志窗口、SSE 和内部提交层的唯一汇聚点
  openOutputFolder: (outputPath: string) => Promise<void>; // 输出目录打开能力由 Electron 宿主专用注入，避免 renderer 暴露通用文件系统入口
}

/**
 * 封装 Electron 公开 API Gateway 的路由和生命周期边界
 */
export class ApiGatewayServer {
  private readonly options: ApiGatewayServerOptions;

  private readonly project_session_state = new ProjectSessionState(); // 公开项目 loaded/path 由 Gateway 持有，避免 renderer 直接读取数据库状态

  private readonly task_runtime_state = new TaskRuntimeState(); // 任务 busy / 请求中数量 / 重翻条目由 API Gateway 维护，避免运行态分散

  private core_event_hub: CoreEventHub | null = null; // core_event_hub 持有本地订阅者，Gateway stop 时必须显式关闭

  private server: Server | null = null; // server 只代表公开 Gateway 监听器，Core 与 Database 生命周期不归这里关闭

  private task_worker_pool: WorkerPool | null = null; // task_worker_pool 持有 worker_threads，Gateway stop 时必须主动释放

  private readonly server_sockets = new Set<Socket>(); // 退出时 renderer SSE 仍可能保持连接，必须由 Gateway 主动切断

  private resolve_api_text: () => TextResolver = () => create_text_resolver("zh-CN");

  /**
   * Gateway 只接收已组装好的运行期依赖，避免路由层自行解析全局状态
   */
  public constructor(options: ApiGatewayServerOptions) {
    this.options = options;
  }

  /**
   * 重复 start 返回同一入口，避免公开端口在运行期漂移
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
      track_api_gateway_connections(pending_server, this.server_sockets);

      pending_server.once("error", handle_start_error);
    });
    this.server = server;
    return { baseUrl: this.base_url() };
  }

  /**
   * 只释放 Gateway 自己持有的监听器，Core 与 Database 生命周期由上层编排
   */
  public async stop(): Promise<void> {
    this.options.appSettingService.set_event_publisher(null);
    this.core_event_hub?.stop();
    this.core_event_hub = null;
    await this.task_worker_pool?.dispose();
    this.task_worker_pool = null;
    const server = this.server;
    this.server = null;
    if (server === null) {
      return;
    }
    await close_api_gateway_with_connections(server, this.server_sockets);
  }

  /**
   * 公开 `/api/*` 协议在这里集中注册，避免 renderer 依赖内部实现端口
   */
  private create_app(): Hono {
    const paths = this.options.paths;
    const app_setting_service = this.options.appSettingService;
    const metadata = this.options.metadata;
    const project_runtime_projection_service = new ProjectRuntimeProjectionService(
      this.options.database,
    );
    const project_change_adapter = new ProjectChangeEventAdapter(
      this.options.database,
      this.project_session_state,
      project_runtime_projection_service,
    );
    const core_event_hub = new CoreEventHub();
    const project_change_publisher = new ProjectChangePublisher(
      project_change_adapter,
      core_event_hub,
    );
    this.core_event_hub = core_event_hub;
    core_event_hub.start();
    app_setting_service.set_event_publisher(core_event_hub);
    this.resolve_api_text = () => {
      return create_text_resolver(
        resolve_i18n_locale(app_setting_service.read_setting()["app_language"]),
      );
    };
    const model_service = new ModelService(
      paths,
      app_setting_service,
      metadata.build_linguagacha_user_agent(),
      this.options.logManager,
    );
    const project_lifecycle_service = new ProjectLifecycleService(
      this.options.database,
      this.project_session_state,
      app_setting_service,
      paths,
      this.options.logManager,
    );
    const project_service = new ProjectSyncMutationService(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
      project_change_publisher,
    );
    const proofreading_service = new ProofreadingService(
      this.options.database,
      this.project_session_state,
      project_change_publisher,
    );
    const task_snapshot_builder = new TaskSnapshotBuilder(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
      project_runtime_projection_service,
    );
    const task_runtime_publisher = new TaskRuntimePublisher(
      core_event_hub,
      this.task_runtime_state,
      task_snapshot_builder,
    );
    const project_task_store = new ProjectTaskStore(
      this.options.database,
      this.project_session_state,
      this.task_runtime_state,
      project_change_publisher,
    );
    const executor_client = new WorkerPool({
      appRoot: paths.get_app_root(),
    });
    this.task_worker_pool = executor_client;
    const task_engine = new TaskEngine({
      appRoot: paths.get_app_root(),
      taskStore: project_task_store,
      taskRuntimePublisher: task_runtime_publisher,
      executorClient: executor_client,
      tokenCounter: create_o200k_base_token_counter(), // 生产切块预算固定走 o200k_base 真实计数，不在 Gateway 保留估算分支
      AppSettingService: app_setting_service,
      logManager: this.options.logManager,
    });
    const task_service = new TaskService(
      task_engine,
      task_snapshot_builder,
      task_runtime_publisher,
      this.project_session_state,
      app_setting_service,
    );
    const project_reset_preview_service = new ProjectResetPreviewService(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
    );
    const file_preview_service = new FilePreviewService(app_setting_service);
    const file_export_service = new FileExportService(
      this.options.database,
      app_setting_service,
      this.project_session_state,
      this.options.openOutputFolder,
      this.options.logManager,
    );
    const quality_service = new QualityService(
      paths,
      app_setting_service,
      this.options.database,
      this.project_session_state,
      project_change_publisher,
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
          version: metadata.read_version(),
        }),
      );
    });

    app.get("/api/logs/stream", () => {
      return this.create_log_stream_response();
    });
    app.get("/api/events/stream", () => {
      return core_event_hub.create_stream_response();
    });
    this.post_json(app, "/api/project/manifest", () =>
      project_runtime_projection_service.build_manifest(this.project_session_state.snapshot()),
    );
    this.post_json(app, "/api/project/read-sections", (body) =>
      project_runtime_projection_service.build_section_payloads({
        projectState: this.project_session_state.snapshot(),
        sections: normalizeProjectDataSections(body["sections"]),
      }),
    );
    this.post_json(app, "/api/project/items/read-by-ids", (body) =>
      project_runtime_projection_service.build_item_record_map_by_ids(
        this.require_loaded_project_path(),
        this.normalize_positive_integer_list(body["itemIds"] ?? body["item_ids"]),
      ),
    );
    this.post_json(app, "/api/settings/app", () => app_setting_service.get_app_settings());
    this.post_json(app, "/api/settings/update", (body) =>
      app_setting_service.update_app_settings(body),
    );
    this.post_json(app, "/api/settings/recent-projects/add", (body) =>
      app_setting_service.add_recent_project(body),
    );
    this.post_json(app, "/api/settings/recent-projects/remove", (body) =>
      app_setting_service.remove_recent_project(body),
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
    this.post_json(app, "/api/tasks/start", (body) => task_service.start_task(body));
    this.post_json(app, "/api/tasks/stop", (body) => task_service.stop_task(body));
    this.post_json(app, "/api/tasks/snapshot", (body) => task_service.get_task_snapshot(body));
    this.post_json(app, "/api/tasks/translate-single", (body) =>
      task_service.translate_single(body),
    );
    this.post_json(app, "/api/tasks/generate-translation", () =>
      file_export_service.generate_translation(),
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
      const error = new RouteNotFoundError(context.req.path);
      return context.json(
        this.error_to_envelope(error, crypto.randomUUID()),
        resolve_app_error_http_status(error),
      );
    });

    return app;
  }

  /**
   * 直接处理路由复用同一响应壳，避免错误码和 CORS 语义在各路由发散
   */
  private post_json(
    app: Hono,
    path_name: string,
    handler: (
      body: Record<string, ApiJsonValue>,
    ) => Record<string, ApiJsonValue> | Promise<Record<string, ApiJsonValue>>,
  ): void {
    app.post(path_name, async (context) => {
      const request_id = crypto.randomUUID();
      try {
        const body = (await context.req.json().catch((error: unknown) => {
          throw new InvalidJsonError(error);
        })) as Record<string, ApiJsonValue>;
        const data = await handler(body);
        return context.json(ok(data));
      } catch (error) {
        const normalized_error = this.normalize_error_to_app_error(error);
        const envelope = this.error_to_envelope(normalized_error, request_id);
        const status = resolve_app_error_http_status(normalized_error);
        if (status >= 500 || normalized_error.severity !== "expected") {
          record_app_error(normalized_error, {
            logManager: this.options.logManager,
            message: t_main_log("app.diagnostic.api_gateway.direct_route_failed"),
            source: "api-gateway",
            context: {
              code: normalized_error.code,
              details: normalized_error.public_details,
              path: path_name,
              request_id,
              status,
            },
          });
        }
        return context.json(envelope, status);
      }
    });
  }

  /**
   * 项目数据局部读取必须绑定当前 loaded 工程，避免 renderer 指定任意 .lg 路径
   */
  private require_loaded_project_path(): string {
    const state = this.project_session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * item id 查询只接受正整数列表，坏值在读取入口直接丢弃
   */
  private normalize_positive_integer_list(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value
          .map((item) => Number(item))
          .filter((item): item is number => Number.isInteger(item) && item > 0),
      ),
    ];
  }

  /**
   * 内部异常只映射成稳定错误壳，调用方不需要理解 main 进程实现细节
   */
  private normalize_error_to_app_error(error: unknown): AppError {
    if (is_app_error(error)) {
      return error;
    }
    if (error instanceof SyntaxError) {
      return new InvalidJsonError(error);
    }
    const node_code = this.read_node_error_code(error);
    if (node_code === "ENOENT") {
      return new FileNotFoundError({
        public_details: this.safe_path_detail(error),
        cause: error,
      });
    }
    return InternalInvariantError.from_unknown(error);
  }

  /**
   * 响应壳只包含安全字段，request_id 用于 UI 和日志对齐诊断
   */
  private error_to_envelope(error: AppError, request_id: string) {
    return api_error(to_api_error_payload(error, request_id, this.resolve_api_text()));
  }

  private read_node_error_code(error: unknown): string {
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : "";
  }

  private safe_path_detail(error: unknown): AppErrorPublicDetails {
    const candidate =
      typeof error === "object" && error !== null && "path" in error
        ? String(error.path ?? "")
        : "";
    return candidate === "" ? {} : { filename: path.basename(candidate) };
  }

  /**
   * 集中 CORS 头，保持健康检查、代理和预检响应一致
   */
  private cors_headers(): Headers {
    return new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
    });
  }

  /**
   * renderer 只认公开 Gateway 地址，数据库内部资源不会透出到 preload 边界
   */
  private base_url(): string {
    return `http://${CORE_API_HOST}:${this.options.publicPort.toString()}`;
  }

  /**
   * 公开日志流由 LogManager 直接提供，避免窗口依赖内部日志实现
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
   * 日志 SSE frame 使用固定事件名，renderer 日志面板只需订阅 log.appended
   */
  private build_log_sse_frame(event: LogEvent): string {
    return `event: log.appended\ndata: ${JSON.stringify(event)}\n\n`;
  }
}
