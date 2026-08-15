import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentWebFetchPort, AgentWebFetchResponse } from "./agent-web-fetch";
import {
  create_agent_web_tools,
  type AgentWebFetchDetails,
  type AgentWebPort,
  type AgentWebSearchPort,
  type AgentWebSearchProvider,
} from "./agent-web-tools";

type WebFetchToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: AgentWebFetchDetails;
};

type WebSearchToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: { provider: AgentWebSearchProvider; truncated: boolean };
};

describe("Agent web_fetch 工具", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("使用真实 Linkedom 与 Defuddle 把 HTML 主体转换为 Markdown", async () => {
    vi.stubGlobal("getComputedStyle", undefined);
    const result = await execute_with_response({
      contentType: "text/html; charset=utf-8",
      body: bytes(`
        <html><head><title>示例文章</title></head><body>
          <nav>导航不应保留</nav>
          <article><h1>正文标题</h1><p>这是足够明确的文章正文，用于验证本地正文识别和 Markdown 转换。阅读<a href="/more">链接</a>。</p><p>第二段继续提供文章内容，避免短页面被误判为导航集合。</p><pre><code>const x = 1;</code></pre></article>
          <footer>页脚不应保留</footer>
        </body></html>
      `),
    });

    expect(result.details).toMatchObject({
      title: "示例文章",
      content_type: "text/html",
      truncated: false,
    });
    expect(result.content[0]?.text).toContain("# 正文标题");
    expect(result.content[0]?.text).toContain("[链接](https://example.com/more)");
    expect(result.content[0]?.text).toContain("const x = 1;");
    expect(result.content[0]?.text).not.toContain("导航不应保留");
    expect(result.content[0]?.text).not.toContain("页脚不应保留");
  });

  it("HTML 无正文时禁止异步 fallback 并明确失败", async () => {
    const external_fetch = vi.fn();
    vi.stubGlobal("fetch", external_fetch);
    vi.stubGlobal("getComputedStyle", undefined);

    await expect(
      execute_with_response({
        contentType: "text/html",
        body: bytes("<html><body></body></html>"),
      }),
    ).rejects.toMatchObject({
      details: { code: "web_fetch.empty_content", content_type: "text/html" },
    });
    expect(external_fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["text/markdown", "# 标题\r\n\r\n正文  ", "# 标题\n\n正文"],
    ["text/plain", " 普通文本\r下一行 ", "普通文本\n下一行"],
    ["text/csv", " a,b\r\n1,2 ", "a,b\n1,2"],
  ])("按 %s 归一为 Markdown 文本", async (content_type, source, expected) => {
    const result = await execute_with_response({ contentType: content_type, body: bytes(source) });
    expect(result.content[0]?.text).toContain(expected);
  });

  it("优先格式化 JSON，格式无效时仍保留原文", async () => {
    const result = await execute_with_response({
      contentType: "application/problem+json",
      body: bytes('{"ok":true,"items":[1]}'),
    });

    expect(result.content[0]?.text).toContain(
      '```json\n{\n  "ok": true,\n  "items": [\n    1\n  ]\n}\n```',
    );
    const invalid = await execute_with_response({
      contentType: "application/json",
      body: bytes("{invalid"),
    });
    expect(invalid.content[0]?.text).toContain("```json\n{invalid\n```");
  });

  it.each(["application/xml", "text/xml", "application/rss+xml"])(
    "把 %s 放入 xml fence",
    async (content_type) => {
      const result = await execute_with_response({
        contentType: content_type,
        body: bytes("<root>值</root>"),
      });
      expect(result.content[0]?.text).toContain("```xml\n<root>值</root>\n```");
    },
  );

  it("缺失 Content-Type 时按纯文本处理", async () => {
    const result = await execute_with_response({ contentType: "", body: bytes("正文") });
    expect(result.content[0]?.text).toContain("正文");
    expect(result.details.content_type).toBeNull();
  });

  it.each(["application/octet-stream", "image/png"])(
    "不支持 %s 时返回 MIME",
    async (content_type) => {
      await expect(
        execute_with_response({ contentType: content_type, body: new Uint8Array([1, 2]) }),
      ).rejects.toMatchObject({
        details: { code: "web_fetch.unsupported_content_type", content_type },
      });
    },
  );

  it.each(["text/plain", "application/xml"])("拒绝 %s 空正文", async (content_type) => {
    await expect(
      execute_with_response({ contentType: content_type, body: bytes(" \r\n ") }),
    ).rejects.toMatchObject({
      details: { code: "web_fetch.empty_content", content_type },
    });
  });

  it("把 HTTP charset 交给统一解码入口", async () => {
    const result = await execute_with_response({
      contentType: 'text/plain; charset="windows-1252"',
      body: new Uint8Array([0xe9]),
    });

    expect(result.content[0]?.text).toContain("é");
  });

  it("正文超限时保留完整字符开头，并让提示与 details 使用同一截断事实", async () => {
    const source = "a".repeat(1_000_000);
    const result = await execute_with_response({
      contentType: "text/plain",
      body: bytes(source),
    });

    const retained = result.content[0]?.text.match(/a{1000,}/u)?.[0] ?? "";
    expect(result.details.truncated).toBe(true);
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThan(source.length);
    expect(result.content[0]?.text).toContain("[内容因长度限制已截断]");
    const surrogate_result = await execute_with_response({
      contentType: "text/plain",
      body: bytes(`${"a".repeat(retained.length - 1)}😀`),
    });
    expect(surrogate_result.content[0]?.text).not.toContain("😀");
    expect(surrogate_result.content[0]?.text).not.toContain("\ud83d");
    expect(surrogate_result.details.truncated).toBe(true);
  });

  it("模型结果只包含来源、Content-Type 和正文，details 不复制正文", async () => {
    const result = await execute_with_response(
      {
        url: "https://example.com/final",
        contentType: "text/plain; charset=utf-8",
        body: bytes("正文"),
      },
      "https://example.com/start",
    );

    expect(result.content[0]?.text).toBe(
      "来源 URL：https://example.com/final\nContent-Type：text/plain\n\n正文",
    );
    expect(result.details).toEqual({
      requested_url: "https://example.com/start",
      url: "https://example.com/final",
      title: null,
      content_type: "text/plain",
      truncated: false,
    });
    expect(result.details).not.toHaveProperty("body");
  });

  it("调用前已取消时不触达端口，执行中取消原样传播 signal", async () => {
    const port = vi.fn<AgentWebFetchPort>();
    const tool = read_web_tool("web_fetch", { read: port, search: vi.fn() });
    const pre_aborted = new AbortController();
    pre_aborted.abort(new Error("提前取消"));

    await expect(
      tool.execute(
        "pre",
        { url: "https://example.com" },
        pre_aborted.signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("提前取消");
    expect(port).not.toHaveBeenCalled();

    const running = new AbortController();
    const reason = new Error("执行中取消");
    port.mockImplementationOnce(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          expect(signal).toBe(running.signal);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const execution = tool.execute(
      "running",
      { url: "https://example.com" },
      running.signal,
      undefined,
      undefined as never,
    );
    const rejection = expect(execution).rejects.toBe(reason);
    running.abort(reason);
    await rejection;
  });
});

describe("Agent web_search 工具", () => {
  it("模型参数只接受非空查询和整数数量", () => {
    const tool = read_web_tool("web_search", { read: vi.fn(), search: vi.fn() });

    expect(tool.parameters).toMatchObject({
      properties: {
        query: { type: "string", minLength: 1 },
        num_results: { type: "integer" },
      },
    });
  });

  it("使用稳定本地参数调用搜索端口并投影来源与原始文本", async () => {
    const search = vi.fn<AgentWebSearchPort>(async () => ({
      provider: "tavily",
      text: "Title: 示例\nURL: https://example.com",
    }));
    const tool = read_web_tool("web_search", { read: vi.fn(), search });
    const signal = new AbortController().signal;

    const result = (await tool.execute(
      "search",
      { query: "当前示例", num_results: 3 },
      signal,
      undefined,
      undefined as never,
    )) as WebSearchToolResult;

    expect(search).toHaveBeenCalledWith("当前示例", 3, signal);
    expect(result.content[0]?.text).toBe("Title: 示例\nURL: https://example.com");
    expect(result.details).toEqual({ provider: "tavily", truncated: false });
  });

  it("省略数量时仍限制过长的模型正文", async () => {
    const upstream_text = "a".repeat(1_000_000);
    const search = vi.fn<AgentWebSearchPort>(async () => ({
      provider: "firecrawl",
      text: upstream_text,
    }));
    const tool = read_web_tool("web_search", { read: vi.fn(), search });

    const result = (await tool.execute(
      "search",
      { query: "大量结果" },
      undefined,
      undefined,
      undefined as never,
    )) as WebSearchToolResult;

    const result_text = result.content[0]?.text ?? "";
    expect(result_text).toContain("[内容因长度限制已截断]");
    expect(result_text.match(/a+/u)?.[0]?.length).toBeLessThan(upstream_text.length);
    expect(result.details).toEqual({ provider: "firecrawl", truncated: true });
  });

  it("调用前已取消时不触达搜索端口", async () => {
    const search = vi.fn<AgentWebSearchPort>();
    const tool = read_web_tool("web_search", { read: vi.fn(), search });
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(
      tool.execute(
        "search",
        { query: "不会搜索" },
        controller.signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("提前取消");
    expect(search).not.toHaveBeenCalled();
  });
});

/** 通过统一工具入口投影给定下载响应。 */
async function execute_with_response(
  overrides: Partial<AgentWebFetchResponse>,
  requested_url = "https://example.com/start",
): Promise<WebFetchToolResult> {
  const response: AgentWebFetchResponse = {
    url: "https://example.com/article",
    contentType: "text/plain",
    body: bytes("正文"),
    ...overrides,
  };
  const port = vi.fn<AgentWebFetchPort>().mockResolvedValue(response);
  const tool = read_web_tool("web_fetch", { read: port, search: vi.fn() });
  return (await tool.execute(
    "call",
    { url: requested_url },
    undefined,
    undefined,
    undefined as never,
  )) as WebFetchToolResult;
}

/** 按稳定工具名读取定义，避免测试依赖注册数组顺序。 */
function read_web_tool(name: "web_search" | "web_fetch", web: AgentWebPort) {
  const tool = create_agent_web_tools(web).find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`缺少 ${name} 工具`);
  return tool;
}

/** 生成测试响应使用的 UTF-8 原始字节。 */
function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
