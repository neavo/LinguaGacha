import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

/** 只记录事件流创建地址，订阅投递由实际流消费者测试负责。 */
class EventSourceStub {
  readonly url: string;
  /** 保存公开连接地址供断言。 */
  constructor(url: string) {
    this.url = url;
  }
}

/**
 * 安装当前测试需要的 desktopApp 桥接宿主。
 */
function install_desktop_api_host(base_url: string): void {
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    writable: true,
    value: create_desktop_bridge_api_mock({
      backendApi: {
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
  });

  it("open_event_stream 通过统一 SSE 路径连接 Backend 事件流", async () => {
    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("EventSource", EventSourceStub);

    const { open_event_stream } = await import("./desktop-api");
    const event_source = open_event_stream();

    expect(event_source).toBeInstanceOf(EventSourceStub);
    expect((event_source as unknown as EventSourceStub).url).toBe(
      "http://127.0.0.1:38191/api/events/stream",
    );
  });

  it("分页读取严格校验摘要与游标并传递取消信号", async () => {
    install_desktop_api_host("http://127.0.0.1:38191/");
    const data = {
      status: "ready",
      entries: [
        {
          id: "20260913:1",
          date: "20260913",
          line: 1,
          revision: "rev",
          created_at: "2026-09-13T00:00:00Z",
          level: "info",
          source: "test",
          message_preview: "内容",
          message_length: 2,
        },
      ],
      before: { date: "20260913", line: 0, revision: "rev" },
      after: { date: "20260913", line: 1, revision: "rev" },
      has_more: false,
    };
    const fetch_mock = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) }) as Response,
    );
    vi.stubGlobal("fetch", fetch_mock);
    const { read_log_page } = await import("./desktop-api");
    const controller = new AbortController();
    await expect(
      read_log_page({ date: "20260913", direction: "latest" }, controller.signal),
    ).resolves.toEqual(data);
    expect(fetch_mock).toHaveBeenCalledWith(
      expect.stringContaining("/api/logs/page"),
      expect.objectContaining({ signal: controller.signal }),
    );
    data.entries[0]!.line = -1;
    await expect(read_log_page({ date: "20260913", direction: "latest" })).rejects.toThrow(
      "Invalid log entry",
    );
  });

  it("read_log_detail 读取完整日志详情", async () => {
    const fetch_mock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            detail: {
              id: "20260913:1",
              date: "20260913",
              line: 1,
              revision: "rev",
              created_at: "2026-04-26T00:00:00.000+00:00",
              level: "error",
              source: "engine-worker",
              content: {
                kind: "translation_result",
                summary: ["任务失败"],
                sections: [],
                pairs: [{ src: "原文", dst: "译文" }],
              },
              error: {
                message: "boom",
                stack: "Error: boom",
              },
              context: { unit: "u1" },
            },
          },
        }),
      } as Response;
    });

    install_desktop_api_host("http://127.0.0.1:38191/");
    vi.stubGlobal("fetch", fetch_mock);

    const { read_log_detail } = await import("./desktop-api");

    await expect(read_log_detail("20260913:1", "rev")).resolves.toMatchObject({
      id: "20260913:1",
      level: "error",
      source: "engine-worker",
      content: {
        kind: "translation_result",
        summary: ["任务失败"],
        sections: [],
        pairs: [{ src: "原文", dst: "译文" }],
      },
      error: {
        message: "boom",
        stack: "Error: boom",
      },
      context: { unit: "u1" },
    });
    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:38191/api/logs/detail",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("read_log_detail 拒绝旧 message 详情载荷", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              detail: {
                id: "log-legacy",
                date: "20260913",
                line: 1,
                revision: "rev",
                created_at: "2026-04-26T00:00:00.000+00:00",
                level: "info",
                source: "test",
                message: "旧正文",
              },
            },
          }),
        } as Response;
      }),
    );
    install_desktop_api_host("http://127.0.0.1:38191/");

    const { read_log_detail } = await import("./desktop-api");

    await expect(read_log_detail("log-legacy", "rev")).resolves.toBeNull();
  });

  it("report_renderer_error 通过诊断 API 写入前端异常快照", async () => {
    const fetch_mock = vi.fn(async () => {
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
      error: {
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
          error: {
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

  it("check_github_release_update 解析新版 release 的 Windows x64 与 arm64 zip", async () => {
    const fetch_mock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "MANUAL_BUILD_v1.2.4",
          html_url: "https://github.com/neavo/LinguaGacha/releases/tag/MANUAL_BUILD_v1.2.4",
          assets: [
            {
              name: "LinguaGacha_v1.2.4_Windows_x64.zip",
              browser_download_url:
                "https://github.com/neavo/LinguaGacha/releases/download/MANUAL_BUILD_v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
            },
            {
              name: "LinguaGacha_v1.2.4_Windows_arm64.zip",
              browser_download_url:
                "https://github.com/neavo/LinguaGacha/releases/download/MANUAL_BUILD_v1.2.4/LinguaGacha_v1.2.4_Windows_arm64.zip",
            },
            {
              name: "LinguaGacha_v1.2.4_Linux_x64.AppImage",
              browser_download_url:
                "https://github.com/neavo/LinguaGacha/releases/download/MANUAL_BUILD_v1.2.4/LinguaGacha_v1.2.4_Linux_x64.AppImage",
            },
          ],
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
      windows_zip_urls: {
        x64: "https://github.com/neavo/LinguaGacha/releases/download/MANUAL_BUILD_v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
        arm64:
          "https://github.com/neavo/LinguaGacha/releases/download/MANUAL_BUILD_v1.2.4/LinguaGacha_v1.2.4_Windows_arm64.zip",
      },
    });
  });

  it("check_github_release_update 在新版只缺一个 Windows 架构时保留另一个架构", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: "v1.2.4",
            html_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
            assets: [
              {
                name: "LinguaGacha_MANUAL_BUILD_v1.2.4_Windows_arm64.zip",
                browser_download_url:
                  "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/arm64.zip",
              },
            ],
          }),
        } as Response;
      }),
    );

    const { check_github_release_update } = await import("./desktop-api");

    await expect(check_github_release_update("1.2.3")).resolves.toEqual({
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
      windows_zip_urls: {
        arm64: "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/arm64.zip",
      },
    });
  });

  it("check_github_release_update 在新版缺少 Windows zip 时保留发布页回退信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: "v1.2.4",
            html_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
            assets: [
              {
                name: "LinguaGacha_v1.2.4_macOS_x64.dmg",
                browser_download_url:
                  "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/mac.dmg",
              },
            ],
          }),
        } as Response;
      }),
    );

    const { check_github_release_update } = await import("./desktop-api");

    await expect(check_github_release_update("1.2.3")).resolves.toEqual({
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
      windows_zip_urls: {},
    });
  });

  it.each([
    ["版本未升高", "v1.2.3"],
    ["release tag 无法解析", "nightly"],
  ] as const)("check_github_release_update 在%s时返回 null", async (_case, tag_name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name,
            html_url: `https://github.com/neavo/LinguaGacha/releases/tag/${tag_name}`,
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

  it("api_get 通过统一 envelope 读取 Backend query", async () => {
    const fetch_mock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: { state: "idle", entries: [], skills: [] } }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetch_mock);
    install_desktop_api_host("http://127.0.0.1:38191/");

    const { api_get } = await import("./desktop-api");

    await expect(api_get("/api/agent/snapshot")).resolves.toMatchObject({ state: "idle" });
    expect(fetch_mock).toHaveBeenCalledOnce();
    expect(fetch_mock).toHaveBeenCalledWith("http://127.0.0.1:38191/api/agent/snapshot", {
      method: "GET",
    });
  });

  it("api_fetch 保留 Backend 错误 code 和 details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            error: {
              code: "data.revision_conflict",
              details: { section: "items" },
            },
          }),
        } as Response;
      }),
    );
    install_desktop_api_host("http://127.0.0.1:38191/");

    const { DesktopApiError, api_fetch } = await import("./desktop-api");
    const promise = api_fetch("/api/workbench/files/import", {});

    await expect(promise).rejects.toMatchObject({
      code: "data.revision_conflict",
      details: { section: "items" },
      message: "data.revision_conflict",
    });
    await expect(promise).rejects.toBeInstanceOf(DesktopApiError);
  });
});
