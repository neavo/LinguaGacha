import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";

/**
 * 模拟 EventSource 行为，隔离桌面 API 流测试对浏览器实现的依赖。
 */
class EventSourceStub {
  static instances: EventSourceStub[] = [];

  url: string;
  close = vi.fn();
  listeners = new Map<string, EventListener[]>();
  onerror: ((event: Event) => void) | null = null;

  /**
   * 初始化 EventSourceStub 依赖，保持外部写入口清晰。
   */
  constructor(url: string) {
    this.url = url;
    EventSourceStub.instances.push(this);
  }

  /**
   * 登记测试监听器，模拟 EventSource 多事件订阅行为。
   */
  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  /**
   * 触发测试事件，帮助断言桌面 API 流解析结果。
   */
  emit(type: string, data: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JsonTool.stringifyStrict(data) } as MessageEvent<string>);
    }
  }
}

function install_desktop_api_host(base_url: string): void {
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    writable: true,
    value: {
      shell: {},
      coreApi: {
        baseUrl: base_url,
      },
      openExternalUrl: vi.fn(),
    },
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
      message: "hello",
    });

    await expect(next_event).resolves.toEqual({
      done: false,
      value: {
        id: "log-1",
        sequence: 1,
        created_at: "2026-04-26T00:00:00.000+00:00",
        level: "warning",
        message: "hello",
      },
    });
    expect(EventSourceStub.instances[0]?.url).toBe("http://127.0.0.1:38191/api/logs/stream");
    await iterator.return?.();
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
});
