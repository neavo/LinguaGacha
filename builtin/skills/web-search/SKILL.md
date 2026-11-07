---
name: web-search
description: 搜索互联网，或核实官方译名、作品设定、术语、文件格式等外部信息时使用。
---

# 网页搜索

在 `workspace_run` 脚本中用全局 `fetch` 调用搜索服务。工作区的 `fetch` 使用应用代理。

## 工作方式

1. 按优先级选一个来源。每个脚本只发一次搜索请求，输出响应状态和原始正文。
2. 按「判断结果」检查输出。无效时，在新的 `workspace_run` 调用中换来源或改写查询。脚本内禁止回退循环和重试。
3. 本次对话中优先复用成功的来源，跳过已确认不可用的来源。
4. 所有来源都无有效结果时，告诉用户未取得搜索结果。记忆中的内容不能作为搜索结论。

搜索结果用于定位候选网页。需要核实原文上下文时，再用 `fetch` 读取网页。回答中保留所依据的来源 URL。

## 搜索来源

|优先级|来源|URL|`params.name`|`params.arguments`|
|---|---|---|---|---|
|1|`exa`|`https://mcp.exa.ai/mcp?tools=web_search_exa`|`web_search_exa`|`{ query, numResults: 10 }`|
|2|`tavily`|`https://mcp.tavily.com/mcp/`|`tavily_search`|`{ query, max_results: 10 }`|
|3|`firecrawl`|`https://mcp.firecrawl.dev/v2/mcp`|`firecrawl_search`|`{ query, limit: 10, sources: [{ type: "web" }] }`|
|4|`anysearch`|`https://api.anysearch.com/mcp`|`search`|`{ query, max_results: 10 }`|
|5|`keenable`|`https://api.keenable.ai/mcp`|`search_web_pages`|`{ query }`|

所有来源共用请求头 `Content-Type: application/json` 和 `Accept: application/json, text/event-stream`。`tavily` 额外需要请求头 `X-Tavily-Access-Mode: keyless`。

## 请求示例

```js
const query = "需要搜索的问题";
const response = await fetch("https://mcp.exa.ai/mcp?tools=web_search_exa", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "web_search_exa", arguments: { query, numResults: 10 } },
  }),
  signal: AbortSignal.timeout(15_000),
});
console.log("HTTP", response.status, response.headers.get("content-type"));
console.log(await response.text());
```

换来源时替换 URL、`params.name`、`params.arguments` 和额外请求头。保留 `AbortSignal.timeout`，限制连接和正文读取的等待时间。

## 判断结果

直接阅读 JSON 或 SSE 正文。SSE 的结果位于 `data:` 行后的 JSON 中。

以下情况都算该来源失败：

- 请求超时、网络错误，或 HTTP 状态不是 2xx。
- 正文含 JSON-RPC `error`，或 `result.isError` 为 `true`。
- HTTP 状态为 200，但结果文本是额度用尽、限流或需要授权的说明。

脚本退出码为 `0` 不代表搜索成功。工具名或参数无效时，先对照来源表修正脚本。这类错误不代表来源不可用。

结果为空或与问题无关时，换来源或改写查询。
