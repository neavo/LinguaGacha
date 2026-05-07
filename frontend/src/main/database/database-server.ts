import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { DatabaseConflictError, ProjectDatabase } from "./database-operations";
import type { DatabaseEnvelope, DatabaseOperation } from "./database-types";

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
  response.end(JSON.stringify(envelope));
}

function build_error_envelope(error: unknown): DatabaseEnvelope {
  // 内部 HTTP 边界仍返回稳定错误壳，避免 Python 侧解析 Node 异常结构。
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

// 只监听本机随机端口的内部 database HTTP 服务，不暴露给 preload 或 renderer。
export class DatabaseServer {
  private readonly database = new ProjectDatabase();
  private readonly token = create_database_token();
  private server: http.Server | null = null;
  private base_url: string | null = null;

  public async start(): Promise<DatabaseServerStartResult> {
    if (this.server !== null && this.base_url !== null) {
      return { baseUrl: this.base_url, token: this.token };
    }

    // 使用随机端口和随机 token，避免固定端口成为外部误调用入口。
    const server = http.createServer((request, response) => {
      void this.handle_request(request, response);
    });

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

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.base_url = null;
    this.database.close();

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
        raw_body.byteLength === 0
          ? {}
          : (JSON.parse(raw_body.toString("utf-8")) as Record<string, unknown>);

      if (url.pathname === "/internal/database/op") {
        // 单操作用于普通读写；事务语义只允许走 transaction 路由。
        const operation = body as unknown as DatabaseOperation;
        send_json(response, 200, { ok: true, data: this.database.execute(operation) });
        return;
      }

      if (url.pathname === "/internal/database/transaction") {
        // Python 只负责排队，BEGIN/COMMIT/ROLLBACK 必须在同一个 DB handle 内完成。
        const operations = Array.isArray(body["operations"])
          ? (body["operations"] as DatabaseOperation[])
          : [];
        send_json(response, 200, { ok: true, data: this.database.execute_transaction(operations) });
        return;
      }

      if (url.pathname === "/internal/database/read-asset-content") {
        // bytes 响应不包 JSON，避免大文件 base64 膨胀后再回到 Python。
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
      send_json(response, 500, build_error_envelope(error));
    }
  }
}
