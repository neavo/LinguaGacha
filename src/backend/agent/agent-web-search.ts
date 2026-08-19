import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { is_json_record } from "../../domain/json";
import { AgentToolError } from "./agent-tool";
import type {
  AgentWebSearchPort,
  AgentWebSearchProvider,
  AgentWebSearchResult,
} from "./agent-web-tools";

const WEB_SEARCH_PROVIDER_TIMEOUT_MS = 8_000; // 单家只限制连接与调用，整次搜索服从调用方 signal
const WEB_SEARCH_RESULT_LIMIT = 10; // 仅约束支持数量参数的供应商，不构成模型侧契约

/** 供应商内部失败分类；只有全部来源一致时才提升为同名产品错误。 */
type SearchProviderFailureCode =
  | "rate_limited"
  | "timeout"
  | "upstream_failed"
  | "empty_result"
  | "unavailable";

/** 固定远端工具的全部供应商差异，避免协议分支散入搜索流程。 */
type SearchProviderSpec = Readonly<{
  name: AgentWebSearchProvider;
  url: string;
  headers?: Readonly<Record<string, string>>;
  tool: string;
  create_arguments: (query: string) => Readonly<Record<string, unknown>>;
  classify_failure?: (text: string) => SearchProviderFailureCode | null;
}>;

/** 固定优先顺序同时定义首次首选与失败后的环形尝试顺序。 */
const SEARCH_PROVIDER_SPECS = Object.freeze([
  {
    name: "exa",
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    tool: "web_search_exa",
    create_arguments: (query: string) => ({
      query,
      numResults: WEB_SEARCH_RESULT_LIMIT,
    }),
  },
  {
    name: "tavily",
    url: "https://mcp.tavily.com/mcp/",
    headers: Object.freeze({ "X-Tavily-Access-Mode": "keyless" }),
    tool: "tavily_search",
    create_arguments: (query: string) => ({
      query,
      max_results: WEB_SEARCH_RESULT_LIMIT,
    }),
    classify_failure: classify_tavily_failure,
  },
  {
    name: "firecrawl",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    tool: "firecrawl_search",
    create_arguments: (query: string) => ({
      query,
      limit: WEB_SEARCH_RESULT_LIMIT,
      sources: [{ type: "web" }],
    }),
  },
  {
    name: "anysearch",
    url: "https://api.anysearch.com/mcp",
    tool: "search",
    create_arguments: (query: string) => ({
      query,
      max_results: WEB_SEARCH_RESULT_LIMIT,
    }),
  },
  {
    name: "keenable",
    url: "https://api.keenable.ai/mcp",
    tool: "search_web_pages",
    create_arguments: (query: string) => ({ query }),
  },
] satisfies readonly SearchProviderSpec[]);

/** 保存单个供应商的稳定失败分类，并保留原始协议上下文供本地诊断。 */
class SearchProviderError extends Error {
  /** 错误正文不进入产品输出，供应商与原始 cause 只供本地诊断。 */
  public constructor(
    public readonly provider: AgentWebSearchProvider,
    public readonly code: SearchProviderFailureCode,
    cause?: unknown,
  ) {
    super(
      `Web search provider ${provider} failed with ${code}.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "SearchProviderError";
  }
}

/** 复用一套固定工具 MCP 生命周期；供应商差异只存在于不可变描述。 */
class McpSearchProvider {
  private client: Client | null = null; // 当前可复用的已初始化协议会话
  private transport: StreamableHTTPClientTransport | null = null; // 与 client 同生命周期
  private disposed = false; // 组合根释放后禁止重新建立远端会话

  /** 注入应用版本与唯一供应商描述，不自行发现远端工具。 */
  public constructor(
    private readonly client_version: string,
    private readonly spec: SearchProviderSpec,
  ) {}

  /** 暴露稳定供应商身份，不泄漏可变连接状态。 */
  public get name(): AgentWebSearchProvider {
    return this.spec.name;
  }

  /** 会话 404 只表示远端状态失效；搜索只读且幂等，可重建后安全重试一次。 */
  public async search(query: string, signal: AbortSignal): Promise<string> {
    try {
      try {
        return await this.call_search(query, signal);
      } catch (error) {
        if (!(error instanceof StreamableHTTPError && error.code === 404)) throw error;
      }
      await this.close_connection();
      return await this.call_search(query, signal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw normalize_provider_error(this.name, error);
    }
  }

  /** 关闭活动连接；未触达过的延迟供应商没有资源可释放。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.close_connection();
  }

  /** 固定调用已声明工具，只接受模型可消费的非空文本块。 */
  private async call_search(query: string, signal: AbortSignal): Promise<string> {
    const client = await this.require_client(signal);
    const result = (await client.callTool(
      {
        name: this.spec.tool,
        arguments: this.spec.create_arguments(query),
      },
      CallToolResultSchema,
      {
        signal,
        timeout: WEB_SEARCH_PROVIDER_TIMEOUT_MS,
        maxTotalTimeout: WEB_SEARCH_PROVIDER_TIMEOUT_MS,
      },
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
      throw new SearchProviderError(
        this.name,
        "upstream_failed",
        text === "" ? undefined : new Error(text),
      );
    }
    if (text === "") throw new SearchProviderError(this.name, "empty_result");
    const failure_code = this.spec.classify_failure?.(text);
    if (failure_code) throw new SearchProviderError(this.name, failure_code);
    return text;
  }

  /** 首次搜索才连接；Header 与客户端身份由固定边界注入，HTTP 使用进程 transport。 */
  private async require_client(signal: AbortSignal): Promise<Client> {
    if (this.disposed) throw new SearchProviderError(this.name, "unavailable");
    if (this.client !== null) return this.client;
    const transport = new StreamableHTTPClientTransport(
      new URL(this.spec.url),
      this.spec.headers === undefined ? {} : { requestInit: { headers: this.spec.headers } },
    );
    const client = new Client({ name: "LinguaGacha", version: this.client_version });
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
        timeout: WEB_SEARCH_PROVIDER_TIMEOUT_MS,
        maxTotalTimeout: WEB_SEARCH_PROVIDER_TIMEOUT_MS,
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

  /** 先隔离活动引用再关闭底层资源，避免关闭回调改写后续连接。 */
  private async close_connection(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (client !== null) await client.close();
    else if (transport !== null) await transport.close();
  }
}

/** 应用级固定搜索服务；成功来源晋升，并在后续失败时环形回访其它来源。 */
export class WebSearchService {
  private readonly providers: readonly McpSearchProvider[]; // 固定顺序的应用级延迟连接
  private preferred_provider_index = 0; // 仅随应用进程存在，工程切换不重置
  private disposed = false; // 组合根释放后阻止重新触达任何供应商

  /** 创建固定五源但不建立连接，避免未使用 Web 工具产生启动网络请求。 */
  public constructor(client_version: string) {
    this.providers = SEARCH_PROVIDER_SPECS.map(
      (spec) => new McpSearchProvider(client_version, spec),
    );
  }

  /** 从当前首选开始串行尝试，成功来源晋升；调用方取消不触发后续来源。 */
  public readonly search: AgentWebSearchPort = async (
    query,
    caller_signal,
  ): Promise<AgentWebSearchResult> => {
    caller_signal.throwIfAborted();
    if (this.disposed) throw new AgentToolError({ code: "web_search.unavailable" });
    const failures: SearchProviderError[] = [];
    // 只在成功后改写首选，失败请求始终能遍历每个来源一次且自然环回恢复来源。
    for (let offset = 0; offset < this.providers.length; offset += 1) {
      const provider_index = (this.preferred_provider_index + offset) % this.providers.length;
      const provider = this.providers[provider_index]!;
      const timeout_signal = AbortSignal.timeout(WEB_SEARCH_PROVIDER_TIMEOUT_MS);
      const signal = AbortSignal.any([caller_signal, timeout_signal]);
      try {
        const text = await provider.search(query, signal);
        this.preferred_provider_index = provider_index;
        return { provider: provider.name, text };
      } catch (error) {
        if (caller_signal.aborted) throw caller_signal.reason;
        failures.push(
          timeout_signal.aborted
            ? new SearchProviderError(provider.name, "timeout", error)
            : normalize_provider_error(provider.name, error),
        );
      }
    }
    throw create_search_error(failures);
  };

  /** 所有已建立的供应商连接都必须完成释放，单个失败不跳过其它连接。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const results = await Promise.allSettled(
      this.providers.map(async (provider) => provider.dispose()),
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close web search provider connections.");
    }
  }
}

/** Tavily 的 keyless 额度耗尽以成功工具正文返回，需恢复为真实限流失败。 */
function classify_tavily_failure(text: string): SearchProviderFailureCode | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return is_json_record(value) && value["code"] === "monthly_cap_reached_bonus_eligible"
    ? "rate_limited"
    : null;
}

/** 将协议与工具失败压缩成供应商内部分类，避免远端正文进入产品错误。 */
function normalize_provider_error(
  provider: AgentWebSearchProvider,
  error: unknown,
): SearchProviderError {
  if (error instanceof SearchProviderError) return error;
  if (error instanceof StreamableHTTPError && error.code === 429) {
    return new SearchProviderError(provider, "rate_limited", error);
  }
  return new SearchProviderError(provider, "unavailable", error);
}

/** 只有全部来源共享同一明确原因时保留细分错误，否则统一视为不可用。 */
function create_search_error(failures: readonly SearchProviderError[]): AgentToolError {
  const first_code = failures[0]?.code;
  const code =
    first_code !== undefined && failures.every((failure) => failure.code === first_code)
      ? first_code
      : "unavailable";
  return new AgentToolError(
    { code: `web_search.${code}` },
    new AggregateError(failures, "All web search providers failed."),
  );
}
