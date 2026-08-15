import type { FetchFunction } from "@earendil-works/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { AgentToolError } from "./agent-tool";
import type { AgentWebSearchPort } from "./agent-web-tools";

// 托管端点、唯一远端工具与整次搜索预算共同构成固定供应商边界。
const EXA_MCP_URL = new URL("https://mcp.exa.ai/mcp?tools=web_search_exa");
const EXA_MCP_TOOL = "web_search_exa";
const WEB_SEARCH_TIMEOUT_MS = 30_000;

/** 固定 Exa MCP 细节的搜索适配器；产品工具不暴露远端工具发现或供应商协议。 */
export class ExaWebSearchClient {
  private client: Client | null = null; // 当前可复用的已初始化协议会话
  private transport: StreamableHTTPClientTransport | null = null; // 与 client 同生命周期的 HTTP 传输
  private disposed = false; // 组合根释放后禁止重新建立远端会话

  /** 注入共享系统代理 fetch 与真实应用版本，不自行创建第二套网络客户端。 */
  public constructor(
    private readonly fetch: FetchFunction,
    private readonly client_version: string,
  ) {}

  /** 首次调用延迟连接并复用会话；Agent Web 工具顺序执行，不建立额外并发层。 */
  public readonly search: AgentWebSearchPort = async (query, num_results, caller_signal) => {
    const timeout_signal = AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS);
    const signal = AbortSignal.any([caller_signal, timeout_signal]); // 用户取消与总时限共享同一次协议调用
    try {
      try {
        return await this.call_search(query, num_results, signal);
      } catch (error) {
        if (!(error instanceof StreamableHTTPError && error.code === 404)) throw error;
      }
      // 404 表示远端会话已失效；搜索只读且幂等，重建后安全重试一次。
      await this.close_connection();
      return await this.call_search(query, num_results, signal);
    } catch (error) {
      if (caller_signal.aborted) throw caller_signal.reason;
      if (timeout_signal.aborted) {
        throw new AgentToolError({ code: "web_search.timeout" }, error);
      }
      throw normalize_web_search_error(error);
    }
  };

  /** 关闭活动 MCP 连接；重复释放保持幂等。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.close_connection();
  }

  /** 调用固定远端工具，只接受模型可消费的非空文本块。 */
  private async call_search(
    query: string,
    num_results: number | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const client = await this.require_client(signal);
    const result = (await client.callTool(
      {
        name: EXA_MCP_TOOL,
        arguments: { query, ...(num_results === undefined ? {} : { numResults: num_results }) },
      },
      CallToolResultSchema,
      { signal, timeout: WEB_SEARCH_TIMEOUT_MS, maxTotalTimeout: WEB_SEARCH_TIMEOUT_MS },
    )) as CallToolResult;
    const text = result.content
      .filter(
        (block): block is Extract<(typeof result.content)[number], { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text.trim())
      .filter((block) => block !== "")
      .join("\n\n");
    if (result.isError === true) {
      throw new AgentToolError(
        { code: "web_search.upstream_failed" },
        text === "" ? undefined : new Error(text),
      );
    }
    if (text === "") {
      throw new AgentToolError({ code: "web_search.empty_result" });
    }
    return text;
  }

  /** 延迟创建并初始化单个 MCP 会话，断线回调同步清空本地引用。 */
  private async require_client(signal: AbortSignal): Promise<Client> {
    if (this.disposed) {
      throw new AgentToolError({ code: "web_search.unavailable" });
    }
    if (this.client !== null) return this.client;
    const transport = new StreamableHTTPClientTransport(EXA_MCP_URL, { fetch: this.fetch });
    const client = new Client({ name: "LinguaGacha", version: this.client_version });
    // 连接前登记成对引用，让同步断线回调也能识别并清空本次会话。
    this.client = client;
    this.transport = transport;
    client.onclose = () => {
      if (this.client === client) {
        this.client = null;
        this.transport = null;
      }
    };
    try {
      await client.connect(transport, {
        signal,
        timeout: WEB_SEARCH_TIMEOUT_MS,
        maxTotalTimeout: WEB_SEARCH_TIMEOUT_MS,
      });
      return client;
    } catch (error) {
      if (this.client === client) {
        this.client = null;
        this.transport = null;
      }
      await transport.close();
      throw error;
    }
  }

  /** 先隔离活动引用再关闭底层资源，避免关闭回调重新改写新连接状态。 */
  private async close_connection(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (client !== null) await client.close();
    else if (transport !== null) await transport.close();
  }
}

/** 将供应商与协议异常压缩为产品工具稳定错误。 */
function normalize_web_search_error(error: unknown): AgentToolError {
  if (error instanceof AgentToolError) return error;
  if (error instanceof StreamableHTTPError && error.code === 429) {
    return new AgentToolError({ code: "web_search.rate_limited" }, error);
  }
  return new AgentToolError({ code: "web_search.unavailable" }, error);
}
