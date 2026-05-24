import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

/**
 * 模拟 EventSource 行为，隔离桌面 API 流测试对浏览器实现的依赖
 */
class EventSourceStub {
  static instances: EventSourceStub[] = [];

  url: string;
  close = vi.fn();
  listeners = new Map<string, EventListener[]>();
  onerror: ((event: Event) => void) | null = null;

  /**
   * 初始化 EventSourceStub 依赖，保持外部写入口清晰
   */
  constructor(url: string) {
    this.url = url;
    EventSourceStub.instances.push(this);
  }

  /**
   * 登记测试监听器，模拟 EventSource 多事件订阅行为
   */
  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  /**
   * 触发测试事件，帮助断言桌面 API 流解析结果
   */
  emit(type: string, data: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JsonTool.stringifyStrict(data) } as MessageEvent<string>);
    }
  }
}

// install_desktop_api_host 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function install_desktop_api_host(base_url: string): void {
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    writable: true,
    value: create_desktop_bridge_api_mock({
      coreApi: {
        baseUrl: base_url,
      },
      methods: {
        openExternalUrl: vi.fn(),
      },
    }),
  });
}

describe("desktop-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    EventSourceStub.instances = [];
  });

  it("open_event_stream 通过统一 SSE 路径连接 Core 事件流", async () => {
    const fetch_mock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            status: "ok",
            service: "linguagacha-core",
            version: "9.9.9",
          },
        }),
      } as Response;
    });

    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("fetch", fetch_mock);
    vi.stubGlobal("EventSource", EventSourceStub);

    const { get_core_metadata, open_event_stream } = await import("./desktop-api");
    const event_source = await open_event_stream();
    const core_metadata = await get_core_metadata();

    expect(fetch_mock).toHaveBeenCalledTimes(1);
    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:38191/api/health",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(event_source).toBeInstanceOf(EventSourceStub);
    expect((event_source as unknown as EventSourceStub).url).toBe(
      "http://127.0.0.1:38191/api/events/stream",
    );
    expect(core_metadata).toEqual({ version: "9.9.9" });
  });

  it("open_log_stream 解析独立日志事件流", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              status: "ok",
              service: "linguagacha-core",
              version: "9.9.9",
            },
          }),
        } as Response;
      }),
    );

    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("EventSource", EventSourceStub);

    const { open_log_stream } = await import("./desktop-api");
    const iterator = open_log_stream()[Symbol.asyncIterator]();
    const next_event = iterator.next();
    await vi.waitFor(() => {
      expect(EventSourceStub.instances).toHaveLength(1);
    });
    EventSourceStub.instances[0]?.emit("log.appended", {
      id: "log-1",
      sequence: 1,
      created_at: "2026-04-26T00:00:00.000+00:00",
      level: "warning",
      source: "test",
      message_preview: "hello",
      message_length: 2048,
    });

    await expect(next_event).resolves.toEqual({
      done: false,
      value: {
        id: "log-1",
        sequence: 1,
        created_at: "2026-04-26T00:00:00.000+00:00",
        level: "warning",
        source: "test",
        message_preview: "hello",
        message_length: 2048,
      },
    });
    expect(EventSourceStub.instances[0]?.url).toBe("http://127.0.0.1:38191/api/logs/stream");
    await iterator.return?.();
  });

  it("open_log_stream 按到达顺序消费积压日志事件", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              status: "ok",
              service: "linguagacha-core",
              version: "9.9.9",
            },
          }),
        } as Response;
      }),
    );

    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("EventSource", EventSourceStub);

    const { open_log_stream } = await import("./desktop-api");
    const iterator = open_log_stream()[Symbol.asyncIterator]();
    const first_read = iterator.next();
    await vi.waitFor(() => {
      expect(EventSourceStub.instances).toHaveLength(1);
    });
    EventSourceStub.instances[0]?.emit("log.appended", {
      id: "log-1",
      sequence: 1,
      created_at: "2026-04-26T00:00:00.000+00:00",
      level: "info",
      source: "engine",
      message_preview: "第一条",
      message_length: 3,
    });
    EventSourceStub.instances[0]?.emit("log.appended", {
      id: "log-2",
      sequence: 2,
      created_at: "2026-04-26T00:00:01.000+00:00",
      level: "error",
      source: "engine-worker",
      message_preview: "第二条",
      message_length: 3,
    });

    await expect(first_read).resolves.toMatchObject({
      done: false,
      value: { id: "log-1", sequence: 1, message_preview: "第一条" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: "log-2", sequence: 2, message_preview: "第二条" },
    });
    await iterator.return?.();
  });

  it("read_log_detail 读取完整日志详情", async () => {
    const fetch_mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              status: "ok",
              service: "linguagacha-core",
              version: "9.9.9",
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            detail: {
              id: "log-1",
              sequence: 1,
              created_at: "2026-04-26T00:00:00.000+00:00",
              level: "error",
              source: "engine-worker",
              message: "完整日志正文",
              error_message: "boom",
              stack: "Error: boom",
              context: { unit: "u1" },
            },
          },
        }),
      } as Response;
    });

    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("fetch", fetch_mock);

    const { read_log_detail } = await import("./desktop-api");

    await expect(read_log_detail("log-1")).resolves.toMatchObject({
      id: "log-1",
      level: "error",
      source: "engine-worker",
      message: "完整日志正文",
      context: { unit: "u1" },
    });
    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:38191/api/logs/detail",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("report_renderer_error 通过诊断 API 写入前端异常快照", async () => {
    const fetch_mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              status: "ok",
              service: "linguagacha-core",
              version: "9.9.9",
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {},
        }),
      } as Response;
    });

    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("fetch", fetch_mock);

    const { report_renderer_error } = await import("./desktop-api");
    await report_renderer_error({
      source: "scheduler",
      diagnostic: {
        message: "批量应用失败",
      },
      route: "workbench",
      triggeringEvent: {
        topic: "project.data_changed",
      },
    });

    expect(fetch_mock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:38191/api/diagnostics/renderer-error",
      expect.objectContaining({
        body: JsonTool.stringifyStrict({
          source: "scheduler",
          diagnostic: {
            message: "批量应用失败",
          },
          route: "workbench",
          triggeringEvent: {
            topic: "project.data_changed",
          },
        }),
        method: "POST",
      }),
    );
  });

  it("check_github_release_update 识别带前缀的新版 release tag", async () => {
    const fetch_mock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "MANUAL_BUILD_v1.2.4",
          html_url: "https://github.com/neavo/LinguaGacha/releases/tag/MANUAL_BUILD_v1.2.4",
        }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetch_mock);

    const { check_github_release_update } = await import("./desktop-api");
    const update = await check_github_release_update("1.2.3");

    expect(fetch_mock).toHaveBeenCalledWith(
      "https://api.github.com/repos/neavo/LinguaGacha/releases/latest",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(update).toEqual({
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/MANUAL_BUILD_v1.2.4",
    });
  });

  it("check_github_release_update 在版本未升高时返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: "v1.2.3",
            html_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.3",
          }),
        } as Response;
      }),
    );

    const { check_github_release_update } = await import("./desktop-api");

    await expect(check_github_release_update("1.2.3")).resolves.toBeNull();
  });

  it("check_github_release_update 忽略无法解析版本的 release tag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: "nightly",
            html_url: "https://github.com/neavo/LinguaGacha/releases/tag/nightly",
          }),
        } as Response;
      }),
    );

    const { check_github_release_update } = await import("./desktop-api");

    await expect(check_github_release_update("1.2.3")).resolves.toBeNull();
  });

  it("check_github_release_update 在 GitHub API 失败时静默返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 404,
        } as Response;
      }),
    );

    const { check_github_release_update } = await import("./desktop-api");

    await expect(check_github_release_update("1.2.3")).resolves.toBeNull();
  });

  it("api_fetch 保留 Core 错误 code、details 和 request_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/health")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                status: "ok",
                service: "linguagacha-core",
                version: "9.9.9",
              },
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            error: {
              code: "data.revision_conflict",
              message: "数据版本已变化，请刷新后重试 …",
              message_key: "app.error.data.revision_conflict.message",
              details: { section: "items" },
              action: "请刷新当前数据后再次提交 …",
              action_key: "app.error.data.revision_conflict.action",
              request_id: "request-1",
            },
          }),
        } as Response;
      }),
    );
    install_desktop_api_host("http://127.0.0.1:38191/");

    const { DesktopApiError, api_fetch } = await import("./desktop-api");
    const promise = api_fetch("/api/project/workbench/import-files", {});

    await expect(promise).rejects.toMatchObject({
      action: "请刷新当前数据后再次提交 …",
      code: "data.revision_conflict",
      details: { section: "items" },
      message: "数据版本已变化，请刷新后重试 …",
      message_key: "app.error.data.revision_conflict.message",
      request_id: "request-1",
      status: 409,
    });
    await expect(promise).rejects.toBeInstanceOf(DesktopApiError);
  });
});
