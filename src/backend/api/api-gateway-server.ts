import type { Server } from "node:http";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { t_main_log } from "../log/log-text";
import { record_app_error } from "../log/app-error-reporter";
import { renderer_error_report_to_log_payload } from "../log/renderer-error-log-adapter";
import type { LogEvent } from "../../shared/log";
import type { BackendServices } from "../bootstrap/backend-services";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { JsonTool } from "../../shared/utils/json-tool";
import { BACKEND_API_HOST, build_backend_api_base_url } from "./api-base-url";
import {
  AppError,
  normalize_renderer_error_report,
  resolve_app_error_http_status,
} from "../../shared/error";
import type { ApiGatewayStartResult } from "./api-types";
import { api_error_envelope, normalize_api_error } from "./api-error";
import { type ApiJsonHandler, register_post_json_route } from "./api-json";
import { register_api_routes } from "./api-routes";

const LOG_STREAM_KEEPALIVE_INTERVAL_MS = 500; // 日志流 keepalive 短间隔用于保持本机窗口实时性，不作为项目事件节奏

const CORS_ALLOWED_HEADERS = "Content-Type"; // 公开 Gateway 只接受 JSON 请求头，避免 renderer 依赖额外私有请求头

/**
 * Gateway 启动参数由 BackendBootstrap 注入，路由层只消费已组装的 BackendServices。
 */
export interface ApiGatewayServerOptions {
  backendServices: BackendServices; // API、CLI 共用的服务组合根，Gateway 不再自行装配业务依赖
}

/**
 * 封装 Electron 公开 API Gateway 的路由和生命周期边界
 */
export class ApiGatewayServer {
  private readonly options: ApiGatewayServerOptions;

  private server: Server | null = null; // 只代表公开 Gateway 监听器，Backend 与 Database 生命周期不归这里关闭

  private public_base_url = ""; // start 成功后固定，重复 start 必须返回同一公开入口

  private accepting_requests = false; // stop 后拒绝尚未进入 Gateway 处理链的迟到请求

  private readonly in_flight_requests = new Set<Promise<unknown>>(); // 请求解析、业务处理和错误响应全部落稳后，Bootstrap 才能释放后端资源

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
      return { baseUrl: this.public_base_url };
    }
    this.accepting_requests = false;
    const app = this.create_app();
    const server = await new Promise<Server>((resolve, reject) => {
      let pending_server: Server;
      const handle_start_error = (error: Error): void => {
        pending_server.close();
        this.server = null;
        this.accepting_requests = false;
        reject(error);
      };
      pending_server = serve(
        {
          fetch: app.fetch,
          hostname: BACKEND_API_HOST,
          port: 0,
        },
        () => {
          pending_server.off("error", handle_start_error);
          const address = pending_server.address();
          if (address === null || typeof address === "string") {
            handle_start_error(new Error("API Gateway did not obtain a local listening port."));
            return;
          }
          this.public_base_url = build_backend_api_base_url(address.port);
          resolve(pending_server);
        },
      ) as Server;

      pending_server.once("error", handle_start_error);
    });
    this.server = server;
    this.accepting_requests = true;
    return { baseUrl: this.public_base_url };
  }

  /**
   * 只释放 Gateway 自己持有的监听器，Backend 与 Database 生命周期由上层编排
   */
  public async stop(): Promise<void> {
    this.accepting_requests = false;
    const server = this.server;
    this.server = null;
    this.public_base_url = "";
    if (server === null) {
      await this.wait_for_in_flight_requests();
      return;
    }
    let close_error: unknown = null;
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeAllConnections();
      });
    } catch (error) {
      close_error = error;
    }
    await this.wait_for_in_flight_requests();
    if (close_error !== null) {
      throw close_error;
    }
  }

  /**
   * Gateway 只装配 HTTP 外壳，公开业务路径集中由 api-routes.ts 注册。
   */
  private create_app(): Hono {
    const services = this.options.backendServices;
    const app = new Hono();

    app.use(
      "*",
      async (context, next) =>
        await this.run_tracked_request(async () => {
          if (context.req.method === "OPTIONS") {
            return new Response(null, { headers: this.cors_headers(), status: 204 });
          }
          await next();
          context.header("Access-Control-Allow-Origin", "*");
          context.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
          context.header("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
        }),
    );

    const route_context = {
      app,
      services,
      postJson: (path_name: string, handler: ApiJsonHandler) =>
        this.post_json(app, path_name, handler),
      createLogStreamResponse: () => this.create_log_stream_response(),
      readLogDetail: (body: JsonRecord) => this.read_log_detail(body),
      recordRendererError: (body: JsonRecord) => this.record_renderer_error(body),
    };

    register_api_routes(route_context);

    app.all("*", (context) => {
      const route_path = context.req.path;
      const error = new AppError("request.route_not_found", {
        public_details: { path: route_path },
        diagnostic_context: { path: route_path },
      });
      return context.json(api_error_envelope(error), resolve_app_error_http_status(error));
    });

    return app;
  }

  /**
   * 直接处理路由复用同一响应壳，避免错误码和 CORS 语义在各路由发散。
   */
  private post_json(app: Hono, path_name: string, handler: ApiJsonHandler): void {
    register_post_json_route(app, path_name, handler, (error, route_path, request_id) => {
      const normalized_error = normalize_api_error(error);
      const envelope = api_error_envelope(normalized_error);
      const status = resolve_app_error_http_status(normalized_error);
      if (status >= 500 || normalized_error.severity !== "expected") {
        record_app_error(normalized_error, {
          logManager: this.options.backendServices.logManager,
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
   * 从 Gateway 中间件入口跟踪完整请求；连接被强制关闭也不能让解析或错误响应越过资源释放边界。
   */
  private async run_tracked_request<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting_requests) {
      throw new AppError("runtime.disposed", {
        diagnostic_context: { reason: "api_gateway_stopping" },
      });
    }
    const operation = Promise.resolve().then(run);
    this.in_flight_requests.add(operation);
    try {
      return await operation;
    } finally {
      this.in_flight_requests.delete(operation);
    }
  }

  /**
   * stop 已关闭接入，因此当前集合清空后不会再出现新的请求处理。
   */
  private async wait_for_in_flight_requests(): Promise<void> {
    if (this.in_flight_requests.size === 0) {
      return;
    }
    await Promise.allSettled(this.in_flight_requests);
  }

  /**
   * 日志详情只从当前进程内详情池读取；旧日志文件不在 API 层扫描。
   */
  private read_log_detail(body: JsonRecord): JsonValue {
    const id = String(body["id"] ?? "").trim();
    return {
      detail:
        id === "" ? null : (this.options.backendServices.logManager.read_detail(id) as JsonValue),
    };
  }

  /**
   * renderer 只能提交已裁剪的异常快照；Gateway 再做一次边界收窄后写入统一 LogManager。
   */
  private record_renderer_error(body: JsonRecord): JsonValue {
    const report = normalize_renderer_error_report(body);

    this.options.backendServices.logManager.error(
      t_main_log("app.diagnostic.renderer.reported_error"),
      {
        source: "renderer",
        ...renderer_error_report_to_log_payload(report),
      },
    );

    return {};
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
        unsubscribe = this.options.backendServices.logManager.subscribe((event) => {
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
