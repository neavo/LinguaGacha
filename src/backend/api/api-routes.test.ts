import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { BackendServices } from "../bootstrap/backend-services";
import type { ApiJsonHandler } from "./api-json";
import { register_api_routes } from "./api-routes";

describe("register_api_routes", () => {
  it("集中注册完整且无重复的公开路径，并把任务与 Agent 请求转交组合根", () => {
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
      model: {
        get_selection_snapshot: vi.fn(() => ({
          model_selection: { translation: "a", analysis: "b", agent: "c" },
          models: [],
        })),
      },
      agent: {
        get_snapshot: vi.fn(() => ({ state: "idle", entries: [], skills: [] })),
        send_message: vi.fn(() => ({ state: "running" })),
        stop: vi.fn(() => ({ state: "idle" })),
      },
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
    expect(get_paths).toEqual([
      "/api/health",
      "/api/logs/stream",
      "/api/events/stream",
      "/api/agent/snapshot",
      "/api/models/selection",
    ]);
    expect(new Set(all_paths).size).toBe(all_paths.length);
    expect(new Set(post_paths)).toEqual(
      new Set([
        "/api/logs/detail",
        "/api/diagnostics/renderer-error",
        "/api/agent/message",
        "/api/agent/stop",
        "/api/session/project/manifest",
        "/api/session/project/snapshot",
        "/api/session/project/close",
        "/api/session/project/preview",
        "/api/session/source-files/collect",
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
        "/api/proofreading/view",
        "/api/proofreading/item/save",
        "/api/proofreading/translations/clear",
        "/api/proofreading/items/set-status",
        "/api/proofreading/items/replace-all",
        "/api/quality/statistics/view",
        "/api/quality/rules/view",
        "/api/quality/prompts/view",
        "/api/quality/rules/save-entries",
        "/api/quality/rules/update-meta",
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
        "/api/models/add",
        "/api/models/delete",
        "/api/models/reset-preset",
        "/api/models/reorder",
        "/api/models/list-available",
        "/api/models/test",
        "/api/tasks/start",
        "/api/tasks/stop",
        "/api/tasks/snapshot",
      ]),
    );

    const start_task_handler = post_json.mock.calls.find(
      ([route_path]) => route_path === "/api/tasks/start",
    )?.[1] as ApiJsonHandler | undefined;
    expect(start_task_handler?.({ task_type: "translation" })).toEqual({ accepted: true });
    expect(start_task).toHaveBeenCalledWith({ task_type: "translation" });

    const snapshot_handler = get.mock.calls.find(
      ([route_path]) => route_path === "/api/agent/snapshot",
    )?.[1] as ((context: { json: (value: unknown) => unknown }) => unknown) | undefined;
    expect(snapshot_handler?.({ json: (value) => value })).toEqual({
      ok: true,
      data: { state: "idle", entries: [], skills: [] },
    });

    const selection_handler = get.mock.calls.find(
      ([route_path]) => route_path === "/api/models/selection",
    )?.[1] as ((context: { json: (value: unknown) => unknown }) => unknown) | undefined;
    expect(selection_handler?.({ json: (value) => value })).toEqual({
      ok: true,
      data: {
        model_selection: { translation: "a", analysis: "b", agent: "c" },
        models: [],
      },
    });

    const message_handler = post_json.mock.calls.find(
      ([route_path]) => route_path === "/api/agent/message",
    )?.[1] as ApiJsonHandler | undefined;
    const message: JsonRecord = {
      parts: [
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "审校" },
      ],
    };
    expect(message_handler?.(message)).toEqual({ state: "running" });
    expect(services.agent.send_message).toHaveBeenCalledWith(message);
  });
});
