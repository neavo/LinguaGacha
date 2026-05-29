import crypto from "node:crypto";

import type { Hono } from "hono";

import { InvalidJsonError } from "../../shared/error";
import { ok, type ApiJsonValue } from "./api-types";

export type ApiJsonHandler = (
  body: Record<string, ApiJsonValue>,
) => ApiJsonValue | Promise<ApiJsonValue>;

export type ApiJsonErrorResponder = (
  error: unknown,
  pathName: string,
  requestId: string,
) => Response | Promise<Response>;

export type ApiPostJsonRoute = (pathName: string, handler: ApiJsonHandler) => void;

/**
 * 公开 POST JSON 路由统一在这里解析请求、包响应壳和生成 request_id。
 */
export function register_post_json_route(
  app: Hono,
  path_name: string,
  handler: ApiJsonHandler,
  on_error: ApiJsonErrorResponder,
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
      return await on_error(error, path_name, request_id);
    }
  });
}
