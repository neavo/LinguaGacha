import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { InvalidJsonError } from "../../shared/error";
import { register_post_json_route } from "./api-json";

describe("register_post_json_route", () => {
  it("解析 JSON 并返回统一成功响应壳", async () => {
    const app = new Hono();
    const handler = vi.fn((body) => ({ echoed: body["value"] ?? null }));
    register_post_json_route(app, "/api/test", handler, () => new Response(null, { status: 500 }));

    const response = await app.request("/api/test", {
      body: JSON.stringify({ value: 7 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    await expect(response.json()).resolves.toEqual({ ok: true, data: { echoed: 7 } });
  });

  it("把 JSON 解析错误、路径和 request_id 交给统一错误出口", async () => {
    const app = new Hono();
    const on_error = vi.fn((_error: unknown, _path_name: string, request_id: string) =>
      Response.json({ request_id }, { status: 400 }),
    );
    register_post_json_route(app, "/api/test", () => ({}), on_error);

    const response = await app.request("/api/test", {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as { request_id?: string };

    expect(response.status).toBe(400);
    expect(on_error).toHaveBeenCalledWith(
      expect.any(InvalidJsonError),
      "/api/test",
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
    );
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
