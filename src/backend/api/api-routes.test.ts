import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { BackendServices } from "../bootstrap/backend-services";
import type { ApiJsonHandler } from "./api-json";
import { register_api_routes } from "./api-routes";

describe("register_api_routes", () => {
  it("集中注册无重复的公开域路径，并把任务请求转交组合根", () => {
    const get = vi.fn();
    const post_json = vi.fn();
    const start_task = vi.fn(() => ({ accepted: true }));
    const services = {
      app: { metadata: {}, settings: {} },
      project: {
        lifecycle: {},
        data: {},
        sessionState: {},
        summary: {},
        content: {},
        resetPreview: {},
      },
      proofreading: { query: {}, commands: {} },
      quality: { statistics: {}, rules: {}, prompts: {} },
      files: { preview: {}, translationExport: {}, tsConversionExport: {} },
      model: {},
      tasks: { start_task },
      create_event_stream_response: vi.fn(),
    } as unknown as BackendServices;

    register_api_routes({
      app: { get } as unknown as Hono,
      services,
      postJson: post_json,
      createLogStreamResponse: vi.fn(),
      readLogDetail: vi.fn(),
      recordRendererError: vi.fn(),
    });

    const get_paths = get.mock.calls.map(([route_path]) => String(route_path));
    const post_paths = post_json.mock.calls.map(([route_path]) => String(route_path));
    const all_paths = [...get_paths, ...post_paths];
    expect(get_paths).toEqual(["/api/health", "/api/logs/stream", "/api/events/stream"]);
    expect(new Set(all_paths).size).toBe(all_paths.length);
    expect([...new Set(all_paths.map((route_path) => route_path.split("/")[2]))].sort()).toEqual([
      "analysis",
      "diagnostics",
      "events",
      "health",
      "logs",
      "models",
      "proofreading",
      "quality",
      "session",
      "settings",
      "tasks",
      "toolbox",
      "translation",
      "workbench",
    ]);

    const start_task_handler = post_json.mock.calls.find(
      ([route_path]) => route_path === "/api/tasks/start",
    )?.[1] as ApiJsonHandler | undefined;
    expect(start_task_handler?.({ task_type: "translation" })).toEqual({ accepted: true });
    expect(start_task).toHaveBeenCalledWith({ task_type: "translation" });
  });
});
