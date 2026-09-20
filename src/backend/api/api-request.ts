import crypto from "node:crypto";

import type { Hono } from "hono";

import type { JsonRecord, JsonValue } from "../../domain/json";
import { AppError } from "../../shared/error";
import { ok } from "./api-types";

export type ApiJsonHandler = (body: JsonRecord) => JsonValue | Promise<JsonValue>;

export type ApiJsonErrorResponder = (
  error: unknown,
  pathName: string,
  requestId: string,
) => Response | Promise<Response>;

export type ApiPostJsonRoute = (pathName: string, handler: ApiJsonHandler) => void;
export type ApiRequestRoute = (
  method: "GET" | "POST",
  pathName: string,
  handler: (request: Request) => Response | Promise<Response>,
) => void;

/** JSON 与字节流共用请求身份和错误壳，业务路由只处理成功载荷。 */
export function register_api_request(
  app: Hono,
  method: "GET" | "POST",
  path_name: string,
  handler: (request: Request) => Response | Promise<Response>,
  on_error: ApiJsonErrorResponder,
): void {
  app.on(method, path_name, async (context) => {
    try {
      return await handler(context.req.raw);
    } catch (error) {
      return await on_error(error, path_name, crypto.randomUUID());
    }
  });
}

/**
 * 公开 POST JSON 路由统一在这里解析请求、包响应壳和生成 request_id。
 */
export function register_post_json_route(
  app: Hono,
  path_name: string,
  handler: ApiJsonHandler,
  on_error: ApiJsonErrorResponder,
): void {
  register_api_request(
    app,
    "POST",
    path_name,
    async (request) => {
      const body = (await request.json().catch((error: unknown) => {
        throw new AppError("request.invalid_json", { cause: error });
      })) as JsonRecord;
      return Response.json(ok(await handler(body)));
    },
    on_error,
  );
}
