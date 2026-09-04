import { describe, expect, it, vi } from "vitest";

import {
  create_agent_web_search_tool,
  type AgentWebSearchPort,
  type AgentWebSearchProvider,
} from "./web-search";

type WebSearchToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: { provider: AgentWebSearchProvider; truncated: boolean };
};

describe("Agent web_search 工具", () => {
  it("模型参数只接受非空自然语言查询", () => {
    const tool = create_agent_web_search_tool(vi.fn());

    expect(tool.parameters).toMatchObject({
      properties: {
        query: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    });
  });

  it("调用稳定搜索端口并投影来源与原始文本", async () => {
    const search = vi.fn<AgentWebSearchPort>(async () => ({
      provider: "tavily",
      text: "Title: 示例\nURL: https://example.com",
    }));
    const tool = create_agent_web_search_tool(search);
    const signal = new AbortController().signal;

    const result = (await tool.execute(
      "search",
      { query: "当前示例" },
      signal,
      undefined,
      undefined as never,
    )) as WebSearchToolResult;

    expect(search).toHaveBeenCalledWith("当前示例", signal);
    expect(result.content[0]?.text).toBe("Title: 示例\nURL: https://example.com");
    expect(result.details).toEqual({ provider: "tavily", truncated: false });
  });

  it("限制过长的模型正文", async () => {
    const upstream_text = "a".repeat(1_000_000);
    const search = vi.fn<AgentWebSearchPort>(async () => ({
      provider: "firecrawl",
      text: upstream_text,
    }));

    const result = (await create_agent_web_search_tool(search).execute(
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
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(
      create_agent_web_search_tool(search).execute(
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
