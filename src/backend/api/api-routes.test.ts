import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { BackendServices } from "../bootstrap/backend-services";
import type { ApiJsonHandler } from "./api-json";
import { register_api_routes } from "./api-routes";

/** 路由集合是公开面契约，注册顺序不是。 */
const GET_PATHS = new Set([
  "/api/health",
  "/api/logs/stream",
  "/api/events/stream",
  "/api/agent/snapshot",
  "/api/models/selection",
]);

const POST_PATHS = new Set([
  "/api/logs/detail",
  "/api/diagnostics/renderer-error",
  "/api/runtime/snapshot",
  "/api/agent/message",
  "/api/agent/round/revise",
  "/api/agent/resume",
  "/api/agent/stop",
  "/api/agent/reset",
  "/api/session/project/manifest",
  "/api/session/project/snapshot",
  "/api/session/project/close",
  "/api/session/project/preview",
  "/api/session/source-files/summary",
  "/api/session/project/create-preview",
  "/api/session/project/open",
  "/api/session/project/create",
  "/api/session/project/open-preview",
  "/api/workbench/snapshot",
  "/api/workbench/files/import",
  "/api/workbench/file/reset",
  "/api/workbench/file/delete",
  "/api/workbench/files/reorder",
  "/api/workbench/file/parse",
  "/api/workbench/settings-alignment/apply",
  "/api/workbench/translation/reset",
  "/api/workbench/translation/reset-preview",
  "/api/proofreading/query",
  "/api/proofreading/items/update",
  "/api/proofreading/translations/clear",
  "/api/proofreading/items/replace-all",
  "/api/quality/statistics/view",
  "/api/quality/rules/query",
  "/api/quality/prompts/view",
  "/api/quality/rules/update",
  "/api/quality/rules/import",
  "/api/quality/rules/export",
  "/api/quality/rules/presets",
  "/api/quality/rules/presets/read",
  "/api/quality/rules/presets/save",
  "/api/quality/rules/presets/rename",
  "/api/quality/rules/presets/delete",
  "/api/quality/prompts/template",
  "/api/quality/prompts/save",
  "/api/quality/prompts/import",
  "/api/quality/prompts/export",
  "/api/quality/prompts/presets",
  "/api/quality/prompts/presets/read",
  "/api/quality/prompts/presets/save",
  "/api/quality/prompts/presets/rename",
  "/api/quality/prompts/presets/delete",
  "/api/analysis/glossary-import/preview",
  "/api/analysis/reset",
  "/api/analysis/reset-preview",
  "/api/analysis/candidates/list",
  "/api/analysis/glossary/import",
  "/api/translation/files/export",
  "/api/toolbox/ts-conversion/files/export",
  "/api/settings/app",
  "/api/settings/update",
  "/api/settings/recent-projects/add",
  "/api/settings/recent-projects/remove",
  "/api/models/snapshot",
  "/api/models/update",
  "/api/models/select",
  "/api/models/thinking-level/update",
  "/api/models/add",
  "/api/models/delete",
  "/api/models/reset-preset",
  "/api/models/reorder",
  "/api/models/list-available",
  "/api/models/test",
  "/api/tasks/start",
  "/api/tasks/stop",
  "/api/tasks/snapshot",
]);

describe("register_api_routes", () => {
  it("注册完整且无重复的公开路径，不锁定注册顺序", () => {
    const fixture = create_route_fixture();
    const get_paths = fixture.get.mock.calls.map(([route_path]) => String(route_path));
    const post_paths = fixture.post_json.mock.calls.map(([route_path]) => String(route_path));
    const all_paths = [...get_paths, ...post_paths];

    expect(new Set(get_paths)).toEqual(GET_PATHS);
    expect(new Set(post_paths)).toEqual(POST_PATHS);
    expect(new Set(all_paths).size).toBe(all_paths.length);
  });

  it("GET 路由返回 Agent 与模型选择快照", () => {
    const fixture = create_route_fixture();
    const json = (value: unknown) => value;

    expect(read_get_handler(fixture.get, "/api/agent/snapshot")({ json })).toEqual({
      ok: true,
      data: { state: "idle", entries: [], skills: [], contextTokens: null },
    });
    expect(read_get_handler(fixture.get, "/api/models/selection")({ json })).toEqual({
      ok: true,
      data: {
        model_selection: { translation: "a", analysis: "b", agent: "c" },
        models: [],
      },
    });
  });

  it("POST 路由把任务与 Agent 命令原样转交组合根", async () => {
    const fixture = create_route_fixture();
    const task = { task_type: "translation" };
    const message: JsonRecord = { text: "@skill(glossary-audit) 审校" };

    expect(read_post_handler(fixture.post_json, "/api/tasks/start")(task)).toEqual({
      accepted: true,
    });
    expect(fixture.start_task).toHaveBeenCalledWith(task);
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/message")(message),
    ).resolves.toEqual({ state: "running" });
    expect(fixture.send_message).toHaveBeenCalledWith(message);
    const revision = { entryId: "assistant-1", message: { text: "修订", attachments: [] } };
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/round/revise")(revision),
    ).resolves.toEqual({ state: "idle" });
    expect(fixture.revise_latest_round).toHaveBeenCalledWith(revision);
    await expect(read_post_handler(fixture.post_json, "/api/agent/resume")({})).resolves.toEqual({
      state: "running",
    });
    expect(fixture.resume).toHaveBeenCalledOnce();
    expect(read_post_handler(fixture.post_json, "/api/agent/stop")({})).toEqual({
      state: "idle",
    });
    expect(fixture.stop).toHaveBeenCalledWith();
    await expect(read_post_handler(fixture.post_json, "/api/agent/reset")({})).resolves.toEqual({
      state: "idle",
      entries: [],
      skills: [],
      contextTokens: null,
    });
    expect(fixture.reset).toHaveBeenCalledWith();
  });

  it("POST 路由从组合根读取统一运行时快照", () => {
    const fixture = create_route_fixture();

    expect(read_post_handler(fixture.post_json, "/api/runtime/snapshot")({})).toEqual({
      runtime: { revision: 0, owner: null },
    });
  });

  it("source-files 摘要路由把显式路径原样转交生命周期服务", () => {
    const fixture = create_route_fixture();
    const request = { source_paths: ["E:/source"] };

    expect(read_post_handler(fixture.post_json, "/api/session/source-files/summary")(request)).toBe(
      fixture.source_file_summary,
    );
    expect(fixture.summarize_source_files).toHaveBeenCalledWith(request);
  });

  it("设置更新只调用组合根提供的受保护写入口", () => {
    const fixture = create_route_fixture();

    expect(
      read_post_handler(fixture.post_json, "/api/settings/update")({ app_language: "ZH" }),
    ).toEqual({ settings: { app_language: "ZH" } });
    expect(fixture.update_settings).toHaveBeenCalledWith({ app_language: "ZH" });
  });

  it("思考档位更新原样转交模型服务", () => {
    const fixture = create_route_fixture();
    const request = { usage: "agent", thinking_level: "HIGH" };

    expect(
      read_post_handler(fixture.post_json, "/api/models/thinking-level/update")(request),
    ).toEqual({ updated: request });
    expect(fixture.update_selected_model_thinking_level).toHaveBeenCalledWith(request);
  });
});

/** 每个行为独立注册一次，避免跨测试共享 mock 调用历史。 */
function create_route_fixture() {
  const get = vi.fn();
  const post_json = vi.fn();
  const start_task = vi.fn(() => ({ accepted: true }));
  const send_message = vi.fn(async () => ({ state: "running" }));
  const revise_latest_round = vi.fn(async () => ({ state: "idle" }));
  const resume = vi.fn(async () => ({ state: "running" }));
  const stop = vi.fn(() => ({ state: "idle" }));
  const reset = vi.fn(async () => ({
    state: "idle",
    entries: [],
    skills: [],
    contextTokens: null,
  }));
  const update_settings = vi.fn((request: JsonRecord) => ({ settings: request }));
  const update_selected_model_thinking_level = vi.fn((request: JsonRecord) => ({
    updated: request,
  }));
  const source_file_summary = { source_file_count: 1, format_hit_counts: { txt: 1 } };
  const summarize_source_files = vi.fn(() => source_file_summary);
  const services = {
    app: { metadata: {}, settings: {}, updateSettings: update_settings },
    project: {
      lifecycle: { summarize_source_files },
      data: {},
      sessionState: {},
      summary: {},
      content: {},
      resetPreview: {},
    },
    proofreading: { query: {}, commands: {} },
    quality: { statistics: {}, rules: {}, prompts: {} },
    files: { preview: {}, translationExport: {}, tsConversionExport: {} },
    model: {
      get_selection_snapshot: vi.fn(() => ({
        model_selection: { translation: "a", analysis: "b", agent: "c" },
        models: [],
      })),
      update_selected_model_thinking_level,
    },
    agent: {
      get_snapshot: vi.fn(() => ({
        state: "idle",
        entries: [],
        skills: [],
        contextTokens: null,
      })),
      send_message,
      revise_latest_round,
      resume,
      stop,
      reset,
    },
    tasks: { start_task },
    runtime: {
      getSnapshot: vi.fn(() => ({ runtime: { revision: 0, owner: null } })),
    },
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
  return {
    get,
    post_json,
    revise_latest_round,
    resume,
    reset,
    send_message,
    source_file_summary,
    summarize_source_files,
    start_task,
    stop,
    update_selected_model_thinking_level,
    update_settings,
  };
}

/** 读取已注册 GET handler，缺失路径立即给出可定位错误。 */
function read_get_handler(
  get: ReturnType<typeof vi.fn>,
  route_path: string,
): (context: { json: (value: unknown) => unknown }) => unknown {
  const handler = get.mock.calls.find(([candidate]) => candidate === route_path)?.[1];
  if (typeof handler !== "function") throw new Error(`GET 路由未注册：${route_path}`);
  return handler;
}

/** 读取已注册 POST handler，缺失路径立即给出可定位错误。 */
function read_post_handler(
  post_json: ReturnType<typeof vi.fn>,
  route_path: string,
): ApiJsonHandler {
  const handler = post_json.mock.calls.find(([candidate]) => candidate === route_path)?.[1];
  if (typeof handler !== "function") throw new Error(`POST 路由未注册：${route_path}`);
  return handler as ApiJsonHandler;
}
