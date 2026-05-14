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
import { AppPathService } from "../service/path-service";
import { SettingService } from "../service/setting-service";
import { FileExportService } from "../file/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import type { LogEvent } from "../../shared/log";
import { CoreEventHub } from "../events/core-event-hub";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { TaskService } from "../service/task-service";
import { TaskEngine } from "../engine/core/engine";
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
import { app_error, is_app_error, type AppError, type AppErrorDetails } from "./app-error";
import { api_error, ok, type ApiGatewayStartResult, type ApiJsonValue } from "./api-types";

const CORE_API_HOST = "127.0.0.1"; // 公开 Gateway 只监听本机环回地址，避免局域网暴露桌面 API

const LOG_STREAM_KEEPALIVE_INTERVAL_MS = 500; // 日志流 keepalive 短间隔用于保持本机窗口实时性，不作为项目事件节奏

const CORS_ALLOWED_HEADERS = "Content-Type"; // 公开 Gateway 只接受 JSON 请求头，避免 renderer 依赖额外私有请求头

/**
 * Gateway 启动参数由 Electron 生命周期层注入，路由层只消费不可变依赖
 */
export interface ApiGatewayServerOptions {
  appRoot: string; // appRoot 决定版本、预设和用户数据路径解析，不在路由层重新猜测
  publicPort: number; // publicPort 由生命周期端口分配器保证唯一，Gateway 只按该端口监听
  database: ProjectDatabase; // database 由生命周期层注入，Gateway 不负责创建或关闭 .lg 物理存储
  logManager: LogManager; // logManager 是日志窗口、SSE 和内部提交层的唯一汇聚点
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
    const paths = new AppPathService({ appRoot: this.options.appRoot });
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
    const setting_service = new SettingService(paths, core_event_hub);
    const model_service = new ModelService(paths, setting_service, this.options.logManager);
    const project_lifecycle_service = new ProjectLifecycleService(
      this.options.database,
      this.project_session_state,
      setting_service,
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
      appRoot: this.options.appRoot,
    });
    this.task_worker_pool = executor_client;
    const task_engine = new TaskEngine({
      taskStore: project_task_store,
      taskRuntimePublisher: task_runtime_publisher,
      executorClient: executor_client,
      SettingService: setting_service,
      logManager: this.options.logManager,
    });
    const task_service = new TaskService(
      task_engine,
      task_snapshot_builder,
      task_runtime_publisher,
      this.project_session_state,
      setting_service,
    );
    const project_reset_preview_service = new ProjectResetPreviewService(
      this.options.database,
      this.task_runtime_state,
      this.project_session_state,
    );
    const file_preview_service = new FilePreviewService(setting_service);
    const file_export_service = new FileExportService(
      this.options.database,
      setting_service,
      this.project_session_state,
      this.options.logManager,
    );
    const quality_service = new QualityService(
      paths,
      setting_service,
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
          version: paths.read_version(),
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
    this.post_json(app, "/api/settings/app", () => setting_service.get_app_settings());
    this.post_json(app, "/api/settings/update", (body) =>
      setting_service.update_app_settings(body),
    );
    this.post_json(app, "/api/settings/recent-projects/add", (body) =>
      setting_service.add_recent_project(body),
    );
    this.post_json(app, "/api/settings/recent-projects/remove", (body) =>
      setting_service.remove_recent_project(body),
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
      const error = app_error("route_not_found", undefined, { path: context.req.path });
      return context.json(this.app_error_to_envelope(error, crypto.randomUUID()), error.status);
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
          throw app_error("validation_failed", "请求 JSON 无效。", undefined, error);
        })) as Record<string, ApiJsonValue>;
        const data = await handler(body);
        return context.json(ok(data));
      } catch (error) {
        const app_error_payload = this.normalize_error_to_app_error(error);
        const envelope = this.app_error_to_envelope(app_error_payload, request_id);
        if (app_error_payload.status >= 500 || app_error_payload.severity !== "expected") {
          this.log_gateway_error(
            t_main_log("app.diagnostic.api_gateway.direct_route_failed"),
            error,
            {
              code: app_error_payload.code,
              details: app_error_payload.details,
              path: path_name,
              request_id,
              status: app_error_payload.status,
            },
          );
        }
        return context.json(envelope, app_error_payload.status);
      }
    });
  }

  /**
   * 项目数据局部读取必须绑定当前 loaded 工程，避免 renderer 指定任意 .lg 路径
   */
  private require_loaded_project_path(): string {
    const state = this.project_session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw app_error("project_not_loaded");
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
      return app_error("validation_failed", "请求 JSON 无效。", undefined, error);
    }
    const node_code = this.read_node_error_code(error);
    if (node_code === "ENOENT") {
      return app_error("file_not_found", undefined, this.safe_path_detail(error), error);
    }
    if (error instanceof Error) {
      return this.classify_bare_error(error);
    }
    return app_error("internal_invariant", undefined, undefined, error);
  }

  /**
   * 裸 Error 在 Gateway 统一收窄为稳定 code，避免内部文本直接成为公开协议
   */
  private classify_bare_error(error: Error): AppError {
    const message = error.message.trim();
    if (error.name === "DatabaseConflictError") {
      return app_error("database_conflict", undefined, undefined, error);
    }
    if (error.name === "WorkUnitExecutorTransportError") {
      return app_error("worker_failed", undefined, undefined, error);
    }
    if (message.includes("工程未加载")) {
      return app_error("project_not_loaded", undefined, undefined, error);
    }
    if (message.includes("工程文件不存在")) {
      return app_error(
        "project_not_found",
        undefined,
        this.extract_path_basename_detail(message),
        error,
      );
    }
    if (message.includes("任务正在执行") || message.includes("已有后台任务正在运行")) {
      return app_error("task_busy", undefined, undefined, error);
    }
    if (message.includes("revision 冲突")) {
      return app_error(
        "revision_conflict",
        undefined,
        this.extract_revision_detail(message),
        error,
      );
    }
    if (message.includes("不支持的文件格式")) {
      return app_error("unsupported_file_format", undefined, undefined, error);
    }
    if (message.includes("获取模型列表失败") || message.includes("模型列表 HTTP")) {
      return app_error("model_provider_failed", undefined, undefined, error);
    }
    if (message.includes("model not found") || message.includes("模型配置不存在")) {
      return app_error("model_not_found", undefined, undefined, error);
    }
    if (message.includes("缺少 node:") || message.includes("缺少必要能力")) {
      return app_error("runtime_capability_missing", undefined, undefined, error);
    }
    if (this.looks_like_validation_error(message)) {
      return app_error(
        "validation_failed",
        this.safe_validation_message(message),
        undefined,
        error,
      );
    }
    return app_error("internal_invariant", undefined, undefined, error);
  }

  /**
   * 响应壳只包含安全字段，request_id 用于 UI 和日志对齐诊断
   */
  private app_error_to_envelope(error: AppError, request_id: string) {
    return api_error({
      code: error.code,
      message: error.safe_message,
      safe_message: error.safe_message,
      message_key: error.message_key,
      ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
      ...(error.action === undefined ? {} : { action: error.action }),
      request_id,
    });
  }

  private read_node_error_code(error: unknown): string {
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : "";
  }

  private safe_path_detail(error: unknown): AppErrorDetails {
    const candidate =
      typeof error === "object" && error !== null && "path" in error
        ? String(error.path ?? "")
        : "";
    return candidate === "" ? {} : { filename: path.basename(candidate) };
  }

  private extract_path_basename_detail(message: string): AppErrorDetails {
    const raw_path = message.split("：").at(-1)?.trim() ?? "";
    return raw_path === "" ? {} : { filename: path.basename(raw_path) };
  }

  private extract_revision_detail(message: string): AppErrorDetails {
    const section = /section=([^\s，]+)/u.exec(message)?.[1];
    return section === undefined ? {} : { section };
  }

  private looks_like_validation_error(message: string): boolean {
    return (
      message.includes("无效") ||
      message.includes("不能为空") ||
      message.includes("缺少") ||
      message.includes("必须") ||
      message.includes("不能") ||
      message.includes("不存在") ||
      message.includes("not found") ||
      message.includes("must be") ||
      message.includes("invalid") ||
      message.includes("unknown") ||
      message.includes("forbidden")
    );
  }

  private safe_validation_message(message: string): string {
    return message === "" || /[A-Z]:\\|\/Users\/|api[_-]?key|Authorization/iu.test(message)
      ? "请求参数无效。"
      : message;
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

  /**
   * Gateway 自身异常统一打到 日志源，便于和其他内部日志区分
   */
  private log_gateway_error(
    message: string,
    error: unknown,
    context: Record<string, unknown>,
  ): void {
    this.options.logManager.error(message, {
      source: "api-gateway",
      context,
      error_message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
