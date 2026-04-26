import { afterEach, describe, expect, it, vi } from "vitest";

class EventSourceStub {
  url: string;
  close = vi.fn();
  addEventListener = vi.fn();
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
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
});
