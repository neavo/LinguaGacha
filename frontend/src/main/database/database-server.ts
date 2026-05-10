import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { DatabaseConflictError, ProjectDatabase } from "./database-operations";
import type { DatabaseEnvelope, DatabaseOperation } from "./database-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { write_electron_main_error } from "../log/log-bridge";
import {
  close_http_server_with_connections,
  track_http_server_connections,
} from "../server/http-server-connections";

const DATABASE_TOKEN_HEADER_NAME = "x-linguagacha-database-token";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface DatabaseServerStartResult {
  baseUrl: string;
  token: string;
}

function create_database_token(): string {
  return crypto.randomBytes(24).toString("hex");
}

function read_request_body(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function send_json(
  response: ServerResponse,
  status_code: number,
  envelope: DatabaseEnvelope,
): void {
  response.writeHead(status_code, { "Content-Type": JSON_CONTENT_TYPE });
  response.end(JsonTool.stringifyStrict(envelope));
}

function build_error_envelope(error: unknown): DatabaseEnvelope {
  // 内部 HTTP 边界仍返回稳定错误壳，避免调用方解析 Node 异常结构。
  if (error instanceof DatabaseConflictError) {
    return { ok: false, error: { code: "database_conflict", message: error.message } };
  }
  if (error instanceof SyntaxError) {
    return { ok: false, error: { code: "invalid_request", message: "database 请求 JSON 无效。" } };
  }
  if (error instanceof Error) {
    return { ok: false, error: { code: "internal_error", message: error.message } };
  }
  return { ok: false, error: { code: "internal_error", message: "database 内部错误。" } };
}

/**
 * 只监听本机随机端口的内部 database HTTP 服务，不暴露给 preload 或 renderer。
 */
export class DatabaseServer {
  private readonly database: ProjectDatabase;
  private readonly token = create_database_token();
  private server: http.Server | null = null;
  private base_url: string | null = null;
  private readonly server_sockets = new Set<Socket>();

  /**
   * Database Service 自持数据库句柄，API 层只能通过内部 workflow 触达它。
   */
  public constructor(database: ProjectDatabase = new ProjectDatabase()) {
    this.database = database;
  }

  /**
   * 按项目路径复用数据库句柄，确保同一工程只有一个连接。
   */
  public get_database(): ProjectDatabase {
    return this.database;
  }

  /**
   * 重复 start 复用同一内部入口，避免 Core 侧持有的 database baseUrl 失效。
   */
  public async start(): Promise<DatabaseServerStartResult> {
    if (this.server !== null && this.base_url !== null) {
      return { baseUrl: this.base_url, token: this.token };
    }

    // 使用随机端口和随机 token，避免固定端口成为外部误调用入口。
    const server = http.createServer((request, response) => {
      void this.handle_request(request, response);
    });
    track_http_server_connections(server, this.server_sockets);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    if (typeof address !== "object" || address === null) {
      server.close();
      throw new Error("Database Service 未能取得本机监听端口。");
    }

    this.server = server;
    this.base_url = `http://127.0.0.1:${address.port}`;
    return { baseUrl: this.base_url, token: this.token };
  }

  /**
   * Database Service 退出时同步关闭 SQLite handle，避免项目文件继续被占用。
   */
  public async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.base_url = null;

    if (server === null) {
      this.database.close();
      return;
    }

    try {
      await close_http_server_with_connections(server, this.server_sockets);
    } finally {
      this.database.close();
    }
  }

  /**
   * 内部 HTTP 边界先校验 token，再进入唯一 database workflow 写入口。
   */
  private async handle_request(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.headers[DATABASE_TOKEN_HEADER_NAME] !== this.token) {
      send_json(response, 401, {
        ok: false,
        error: { code: "invalid_request", message: "database token 无效。" },
      });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/internal/database/health") {
        send_json(response, 200, { ok: true, data: { status: "ok" } });
        return;
      }

      if (request.method !== "POST") {
        send_json(response, 405, {
          ok: false,
          error: { code: "invalid_request", message: "database 只接受 POST 请求。" },
        });
        return;
      }

      const raw_body = await read_request_body(request);
      const body =
        raw_body.byteLength === 0 ? {} : JsonTool.parseStrict<Record<string, unknown>>(raw_body);

      if (url.pathname === "/internal/database/op") {
        // 单操作用于普通读写；事务语义只允许走 transaction 路由。
        const operation = body as unknown as DatabaseOperation;
        send_json(response, 200, { ok: true, data: this.database.execute(operation) });
        return;
      }

      if (url.pathname === "/internal/database/transaction") {
        // 调用方只负责排队，BEGIN/COMMIT/ROLLBACK 必须在同一个 DB handle 内完成。
        const operations = Array.isArray(body["operations"])
          ? (body["operations"] as DatabaseOperation[])
          : [];
        send_json(response, 200, { ok: true, data: this.database.execute_transaction(operations) });
        return;
      }

      if (url.pathname === "/internal/database/read-asset-content") {
        // bytes 响应不包 JSON，避免大文件 base64 膨胀后再回到调用方。
        const project_path = typeof body["projectPath"] === "string" ? body["projectPath"] : "";
        const asset_path = typeof body["path"] === "string" ? body["path"] : "";
        const content = this.database.read_asset_content(project_path, asset_path);
        if (content === null) {
          response.writeHead(404, { "Content-Type": "application/octet-stream" });
          response.end();
        } else {
          response.writeHead(200, { "Content-Type": "application/octet-stream" });
          response.end(content);
        }
        return;
      }

      send_json(response, 404, {
        ok: false,
        error: { code: "invalid_request", message: "database 路由不存在。" },
      });
    } catch (error) {
      const envelope = build_error_envelope(error);
      if (envelope.ok === false && envelope.error.code === "internal_error") {
        write_electron_main_error("Database Service 请求处理失败", {
          error,
          context: {
            method: request.method ?? "",
            path: url.pathname,
          },
        });
      }
      send_json(response, 500, envelope);
    }
  }
}
