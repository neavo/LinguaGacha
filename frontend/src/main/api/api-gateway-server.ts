import crypto from "node:crypto";
import type { Server } from "node:http";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { ProjectDatabase } from "../database/database-operations";
import { ModelService } from "../model/model-service";
import { ProjectService } from "../project/project-service";
import { QualityService } from "../quality/quality-service";
import { CoreBridgeClient } from "../core/core-bridge-client";
import { AppPathService } from "../paths/app-path-service";
import { ConfigService } from "../settings/config-service";
import { api_error, ok, type ApiGatewayStartResult, type ApiJsonValue } from "./api-types";

const CORE_API_HOST = "127.0.0.1";
const STREAM_PROXY_PATHS = new Set([
  "/api/events/stream",
  "/api/logs/stream",
  "/api/project/bootstrap/stream",
]);

export interface ApiGatewayServerOptions {
  appRoot: string;
  publicPort: number;
  pyCoreBaseUrl: string;
  pyCoreToken: string;
  database: ProjectDatabase;
}

/**
 * 封装 Electron 公开 API Gateway 的路由、代理和生命周期边界。
 */
export class ApiGatewayServer {
  private readonly options: ApiGatewayServerOptions;
  private readonly instance_token = crypto.randomBytes(24).toString("hex");
  private server: Server | null = null;

  /**
   * 初始化 ApiGatewayServer 依赖，保持外部写入口清晰。
   */
  public constructor(options: ApiGatewayServerOptions) {
    this.options = options;
  }

  /**
   * 启动服务并返回稳定入口，避免重复启动产生多份运行态。
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
   * 按拥有者顺序释放资源，避免退出时留下后台监听。
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
   * 组装公开路由和代理规则，保持 Gateway 协议集中维护。
   */
  private create_app(): Hono {
    const paths = new AppPathService({ appRoot: this.options.appRoot });
    const core_bridge = new CoreBridgeClient({
      pyCoreBaseUrl: this.options.pyCoreBaseUrl,
      pyCoreToken: this.options.pyCoreToken,
    });
    const config_service = new ConfigService(paths, core_bridge);
    const model_service = new ModelService(paths, config_service, core_bridge);
    const project_service = new ProjectService(this.options.database, core_bridge);
    const quality_service = new QualityService(
      paths,
      config_service,
      this.options.database,
      core_bridge,
    );
    const app = new Hono();

    app.use("*", async (context, next) => {
      if (context.req.method === "OPTIONS") {
        return new Response(null, { headers: this.cors_headers(), status: 204 });
      }
      await next();
      context.header("Access-Control-Allow-Origin", "*");
      context.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      context.header("Access-Control-Allow-Headers", "Content-Type");
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
    this.post_json(app, "/api/project/settings-alignment/apply", (body) =>
      project_service.apply_settings_alignment(body),
    );
    this.post_json(app, "/api/project/translation/reset", (body) =>
      project_service.apply_translation_reset(body),
    );
    this.post_json(app, "/api/project/analysis/reset", (body) =>
      project_service.apply_analysis_reset(body),
    );
    this.post_json(app, "/api/project/analysis/import-glossary", (body) =>
      project_service.import_analysis_glossary(body),
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
      return this.proxy_to_py_core(context.req.raw);
    });

    return app;
  }

  /**
   * 统一处理 POST JSON 响应壳和错误映射，避免路由各自发散。
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
        return context.json(envelope, status);
      }
    });
  }

  /**
   * 代理未迁移路由到 Python Core，保留公开 API 前缀不变。
   */
  private async proxy_to_py_core(request: Request): Promise<Response> {
    const source_url = new URL(request.url);
    const target_url = `${this.options.pyCoreBaseUrl}${source_url.pathname}${source_url.search}`;
    const headers = new Headers(request.headers);
    headers.delete("host");
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const response = await fetch(target_url, {
      body,
      headers,
      method: request.method,
      signal: request.signal,
    });
    const response_headers = new Headers(response.headers);
    response_headers.delete("content-length");
    response_headers.delete("transfer-encoding");
    for (const [key, value] of this.cors_headers()) {
      response_headers.set(key, value);
    }
    if (STREAM_PROXY_PATHS.has(source_url.pathname)) {
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
   * 把内部异常折叠为稳定错误壳，避免泄漏实现细节。
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
      "Access-Control-Allow-Headers": "Content-Type",
    });
  }

  /**
   * 从公开端口生成 Gateway 地址，作为 renderer 探活的唯一 baseUrl。
   */
  private base_url(): string {
    return `http://${CORE_API_HOST}:${this.options.publicPort.toString()}`;
  }
}
