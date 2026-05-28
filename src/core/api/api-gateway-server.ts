import crypto from "node:crypto";
import type { Server } from "node:http";
import type { Socket } from "node:net";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { t_main_log } from "../log/log-text";
import { record_app_error } from "../log/app-error-reporter";
import { renderer_error_report_to_log_payload } from "../log/renderer-error-log-adapter";
import type { LogEvent } from "../../shared/log";
import type { CoreServices } from "../bootstrap/core-services";
import { JsonTool } from "../../shared/utils/json-tool";
import {
  close_api_gateway_with_connections,
  track_api_gateway_connections,
} from "./api-gateway-connections";
import { CORE_API_HOST, build_core_api_base_url } from "./api-base-url";
import {
  ProjectNotLoadedError,
  RouteNotFoundError,
  normalize_renderer_error_report,
  resolve_app_error_http_status,
  type AppError,
} from "../../shared/error";
import { type ApiGatewayStartResult, type ApiJsonValue } from "./api-types";
import { api_error_envelope, normalize_api_error } from "./api-error";
import { type ApiJsonHandler, register_post_json_route } from "./api-json";
import { register_analysis_routes } from "./routes/analysis-routes";
import { register_diagnostics_routes } from "./routes/diagnostics-routes";
import { register_export_routes } from "./routes/export-routes";
import { register_health_routes } from "./routes/health-routes";
import { register_logs_routes } from "./routes/logs-routes";
import { register_model_routes } from "./routes/model-routes";
import { register_proofreading_routes } from "./routes/proofreading-routes";
import { register_quality_routes } from "./routes/quality-routes";
import { register_settings_routes } from "./routes/settings-routes";
import { register_task_routes } from "./routes/task-routes";
import { register_workbench_routes } from "./routes/workbench-routes";
import { register_project_routes } from "./routes/project-routes";

const LOG_STREAM_KEEPALIVE_INTERVAL_MS = 500; // 日志流 keepalive 短间隔用于保持本机窗口实时性，不作为项目事件节奏

const CORS_ALLOWED_HEADERS = "Content-Type"; // 公开 Gateway 只接受 JSON 请求头，避免 renderer 依赖额外私有请求头

/**
 * Gateway 启动参数由 CoreBootstrap 注入，路由层只消费已组装的 CoreServices。
 */
export interface ApiGatewayServerOptions {
  publicPort: number; // publicPort 由 API 端口分配器保证唯一，Gateway 只按该端口监听
  coreServices: CoreServices; // coreServices 是 API、CLI 共用的服务组合根，Gateway 不再自行装配业务依赖
}

/**
 * 封装 Electron 公开 API Gateway 的路由和生命周期边界
 */
export class ApiGatewayServer {
  private readonly options: ApiGatewayServerOptions;

  private server: Server | null = null; // server 只代表公开 Gateway 监听器，Core 与 Database 生命周期不归这里关闭

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
    const server = this.server;
    this.server = null;
    if (server === null) {
      return;
    }
    await close_api_gateway_with_connections(server, this.server_sockets);
  }

  /**
   * Gateway 只装配 HTTP 外壳和功能路由注册器，业务路径分散到 api/routes。
   */
  private create_app(): Hono {
    const services = this.options.coreServices;
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

    const route_context = {
      app,
      services,
      postJson: (path_name: string, handler: ApiJsonHandler) =>
        this.post_json(app, path_name, handler),
      requireLoadedProjectPath: () => this.require_loaded_project_path(),
      createLogStreamResponse: () => this.create_log_stream_response(),
      readLogDetail: (body: Record<string, ApiJsonValue>) => this.read_log_detail(body),
      recordRendererError: (body: Record<string, ApiJsonValue>) => this.record_renderer_error(body),
    };

    register_health_routes(route_context);
    register_logs_routes(route_context);
    register_diagnostics_routes(route_context);
    register_project_routes(route_context);
    register_workbench_routes(route_context);
    register_proofreading_routes(route_context);
    register_quality_routes(route_context);
    register_analysis_routes(route_context);
    register_export_routes(route_context);
    register_settings_routes(route_context);
    register_model_routes(route_context);
    register_task_routes(route_context);

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
   * 直接处理路由复用同一响应壳，避免错误码和 CORS 语义在各路由发散。
   */
  private post_json(app: Hono, path_name: string, handler: ApiJsonHandler): void {
    register_post_json_route(app, path_name, handler, (error, route_path, request_id) => {
      const normalized_error = normalize_api_error(error);
      const envelope = this.error_to_envelope(normalized_error, request_id);
      const status = resolve_app_error_http_status(normalized_error);
      if (status >= 500 || normalized_error.severity !== "expected") {
        record_app_error(normalized_error, {
          logManager: this.options.coreServices.logs.manager,
          message: t_main_log("app.diagnostic.api_gateway.direct_route_failed"),
          source: "api-gateway",
          context: {
            code: normalized_error.code,
            details: normalized_error.public_details,
            path: route_path,
            request_id,
            status,
          },
        });
      }
      return new Response(JsonTool.stringifyStrict(envelope), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
        status,
      });
    });
  }

  /**
   * 项目数据局部读取必须绑定当前 loaded 工程，避免 renderer 指定任意 .lg 路径。
   */
  private require_loaded_project_path(): string {
    const state = this.options.coreServices.project.sessionState.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * 日志详情只从当前进程内详情池读取；旧日志文件不在 API 层扫描。
   */
  private read_log_detail(body: Record<string, ApiJsonValue>): ApiJsonValue {
    const id = String(body["id"] ?? "").trim();
    return {
      detail:
        id === "" ? null : (this.options.coreServices.logs.manager.read_detail(id) as ApiJsonValue),
    };
  }

  /**
   * renderer 只能提交已裁剪的异常快照；Gateway 再做一次边界收窄后写入统一 LogManager。
   */
  private record_renderer_error(body: Record<string, ApiJsonValue>): ApiJsonValue {
    const report = normalize_renderer_error_report(body);

    this.options.coreServices.logs.manager.error(
      t_main_log("app.diagnostic.renderer.reported_error"),
      {
        source: "renderer",
        ...renderer_error_report_to_log_payload(report),
      },
    );

    return {};
  }

  private error_to_envelope(error: AppError, request_id: string) {
    return api_error_envelope(error, request_id, this.options.coreServices.resolve_api_text());
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
    return build_core_api_base_url(this.options.publicPort);
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
        unsubscribe = this.options.coreServices.logs.manager.subscribe((event) => {
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
    return "event: log.appended\ndata: " + JsonTool.stringifyStrict(event) + "\n\n";
  }
}
