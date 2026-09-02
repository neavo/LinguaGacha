import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { BackendServices } from "../bootstrap/backend-services";
import type { AgentService } from "../agent/agent-service";
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
  "/api/agent/approval-mode",
  "/api/agent/approval/approve",
  "/api/agent/approval/reject",
  "/api/agent/queue/update",
  "/api/agent/queue/delete",
  "/api/agent/queue/reorder",
  "/api/agent/queue/send",
  "/api/agent/round/revise",
  "/api/agent/continue",
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
      data: {
        revision: 0,
        state: "idle",
        approvalMode: "manual",
        pendingWriteApproval: null,
        entries: [],
        skills: [],
        inputQueue: { paused: false, canSendNow: false, items: [] },
        taskProgress: [],
        contextTokens: null,
      },
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
    ).resolves.toEqual({ revision: 7 });
    expect(fixture.send_message).toHaveBeenCalledWith(message);
    const approval_mode = { approvalMode: "auto" };
    expect(read_post_handler(fixture.post_json, "/api/agent/approval-mode")(approval_mode)).toEqual(
      {
        revision: 7,
      },
    );
    expect(fixture.set_approval_mode).toHaveBeenCalledWith(approval_mode);
    const pending = { id: "apply-1", switchToAuto: true };
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/approval/approve")(pending),
    ).resolves.toEqual({ revision: 7 });
    expect(fixture.approve_pending_write).toHaveBeenCalledWith(pending);
    const rejected = { id: "apply-1" };
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/approval/reject")(rejected),
    ).resolves.toEqual({ revision: 7 });
    expect(fixture.reject_pending_write).toHaveBeenCalledWith(rejected);
    const queued = { id: "queue-1" };
    expect(read_post_handler(fixture.post_json, "/api/agent/queue/delete")(queued)).toEqual({
      revision: 7,
    });
    expect(fixture.delete_queued_message).toHaveBeenCalledWith(queued);
    const update = { id: "queue-1", message: { text: "修改", attachments: [] } };
    expect(read_post_handler(fixture.post_json, "/api/agent/queue/update")(update)).toEqual({
      revision: 7,
    });
    expect(fixture.update_queued_message).toHaveBeenCalledWith(update);
    const reorder = { ids: ["queue-2", "queue-1"] };
    expect(read_post_handler(fixture.post_json, "/api/agent/queue/reorder")(reorder)).toEqual({
      revision: 7,
    });
    expect(fixture.reorder_queued_messages).toHaveBeenCalledWith(reorder);
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/queue/send")(queued),
    ).resolves.toEqual({ revision: 7 });
    expect(fixture.send_queued_message).toHaveBeenCalledWith(queued);
    const continuation = { message: { text: "继续后追加", attachments: [] } };
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/continue")(continuation),
    ).resolves.toEqual({ revision: 7 });
    expect(fixture.continue_session).toHaveBeenCalledWith(continuation);
    const revision = { entryId: "assistant-1", message: { text: "修订", attachments: [] } };
    await expect(
      read_post_handler(fixture.post_json, "/api/agent/round/revise")(revision),
    ).resolves.toEqual({ revision: 7 });
    expect(fixture.revise_latest_round).toHaveBeenCalledWith(revision);
    expect(read_post_handler(fixture.post_json, "/api/agent/stop")({})).toEqual({ revision: 7 });
    expect(fixture.stop).toHaveBeenCalledWith();
    await expect(read_post_handler(fixture.post_json, "/api/agent/reset")({})).resolves.toEqual({
      revision: 7,
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
  const acknowledgement = { revision: 7 };
  const send_message = vi.fn(async () => acknowledgement);
  const set_approval_mode = vi.fn(() => acknowledgement);
  const approve_pending_write = vi.fn(async () => acknowledgement);
  const reject_pending_write = vi.fn(async () => acknowledgement);
  const revise_latest_round = vi.fn(async () => acknowledgement);
  const update_queued_message = vi.fn(() => acknowledgement);
  const delete_queued_message = vi.fn(() => acknowledgement);
  const reorder_queued_messages = vi.fn(() => acknowledgement);
  const send_queued_message = vi.fn(async () => acknowledgement);
  const continue_session = vi.fn(async () => acknowledgement);
  const stop = vi.fn(() => acknowledgement);
  const reset = vi.fn(async () => acknowledgement);
  const update_settings = vi.fn((request: JsonRecord) => ({ settings: request }));
  const update_selected_model_thinking_level = vi.fn((request: JsonRecord) => ({
    updated: request,
  }));
  const source_file_summary = { source_file_count: 1, format_hit_counts: { txt: 1 } };
  const summarize_source_files = vi.fn(() => source_file_summary);
  const agent = {
    get_snapshot: vi.fn(() => ({
      revision: 0,
      state: "idle",
      approvalMode: "manual",
      pendingWriteApproval: null,
      entries: [],
      skills: [],
      inputQueue: { paused: false, canSendNow: false, items: [] },
      taskProgress: [],
      contextTokens: null,
    })),
    send_message,
    set_approval_mode,
    approve_pending_write,
    reject_pending_write,
    update_queued_message,
    delete_queued_message,
    reorder_queued_messages,
    send_queued_message,
    continue_session,
    revise_latest_round,
    stop,
    reset,
  } as unknown as AgentService;
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
    tasks: { start_task },
    runtime: {
      getSnapshot: vi.fn(() => ({ runtime: { revision: 0, owner: null } })),
    },
  } as unknown as BackendServices;

  register_api_routes({
    app: { get } as unknown as Hono,
    services,
    agent,
    postJson: post_json,
    createEventStreamResponse: vi.fn(),
    createLogStreamResponse: vi.fn(),
    readLogDetail: vi.fn(),
    recordRendererError: vi.fn(),
  });
  return {
    get,
    post_json,
    continue_session,
    delete_queued_message,
    revise_latest_round,
    reset,
    send_message,
    set_approval_mode,
    approve_pending_write,
    reject_pending_write,
    send_queued_message,
    reorder_queued_messages,
    update_queued_message,
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
