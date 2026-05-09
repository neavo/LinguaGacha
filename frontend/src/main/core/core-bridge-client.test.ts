import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreBridgeClient } from "./core-bridge-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub_fetch(data: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, data }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }),
  );
}

describe("CoreBridgeClient", () => {
  it("读取 Python 内部项目状态并规范化缺失字段", async () => {
    stub_fetch({ loaded: true, busy: true });
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.get_project_state()).resolves.toEqual({
      loaded: true,
      projectPath: "",
      busy: true,
    });
  });

  it("解析受保护 asset 桥返回，只保留对象型文件和条目", async () => {
    stub_fetch({
      files: [
        {
          rel_path: "book.epub",
          items: [{ src: "章节" }, null],
        },
        null,
      ],
    });
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.parse_project_assets("demo.lg", ["book.epub"])).resolves.toEqual([
      {
        rel_path: "book.epub",
        items: [{ src: "章节" }],
      },
    ]);
  });

  it("EPUB 源文件预览桥会规范化文件和条目对象", async () => {
    stub_fetch({
      files: [
        {
          source_path: "book.epub",
          target_rel_path: "old/book.epub",
          file_type: "EPUB",
          parsed_items: [{ src: "章节" }, null],
        },
      ],
    });
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.parse_source_epub_files(["book.epub"], "old/demo.epub")).resolves.toEqual([
      {
        source_path: "book.epub",
        target_rel_path: "old/book.epub",
        file_type: "EPUB",
        parsed_items: [{ src: "章节" }],
      },
    ]);
  });

  it("EPUB 导出桥调用内部 runtime 路由并携带目录载荷", async () => {
    const fetch_mock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, data: { accepted: true } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetch_mock);
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await client.export_epub_items("demo.lg", "out", "out_bi", [{ file_type: "EPUB" }]);

    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/internal/runtime/export-epub-items",
      expect.objectContaining({
        body: JSON.stringify({
          projectPath: "demo.lg",
          translatedPath: "out",
          bilingualPath: "out_bi",
          items: [{ file_type: "EPUB" }],
        }),
      }),
    );
  });

  it("Python Core 返回错误壳时抛出公开错误消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ ok: false, error: { message: "失败" } }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        });
      }),
    );
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.get_task_snapshot()).rejects.toThrow("失败");
  });
});
