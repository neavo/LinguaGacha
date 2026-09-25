import {
  Client,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";

import { is_json_record } from "../../domain/json";
import { AgentToolError } from "./model-tools/definition";
import type {
  AgentWebSearchPort,
  AgentWebSearchProvider,
  AgentWebSearchResult,
} from "./model-tools/web-search";

const WEB_SEARCH_PROVIDER_TIMEOUT_MS = 8_000; // 单家连接、调用与会话重建共用一次预算
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
    super(`Web search provider ${provider} failed with ${code}.`, { cause });
    this.name = "SearchProviderError";
  }
}

/** 应用级固定搜索服务；成功来源晋升，并在后续失败时环形回访其它来源。 */
export class WebSearchService {
  private readonly clients = new Map<AgentWebSearchProvider, Client>(); // 拥有连接中的客户端及可复用会话
  private preferred_provider_index = 0; // 仅随应用进程存在，工程切换不重置
  private disposed = false; // 组合根释放后阻止重新触达任何供应商

  /** 工具按 sequential 调用，组合根先等待 Agent 释放，再关闭本服务。 */
  public constructor(private readonly client_version: string) {}

  /** 从当前首选开始串行尝试，成功来源晋升；调用方取消不触发后续来源。 */
  public readonly search: AgentWebSearchPort = async (
    query,
    caller_signal,
  ): Promise<AgentWebSearchResult> => {
    caller_signal.throwIfAborted();
    if (this.disposed) throw new AgentToolError({ code: "web_search.unavailable" });
    const failures: SearchProviderError[] = [];
    // 只在成功后改写首选，失败请求始终能遍历每个来源一次且自然环回恢复来源。
    for (let offset = 0; offset < SEARCH_PROVIDER_SPECS.length; offset += 1) {
      const provider_index =
        (this.preferred_provider_index + offset) % SEARCH_PROVIDER_SPECS.length;
      const provider = SEARCH_PROVIDER_SPECS[provider_index]!;
      const timeout_signal = AbortSignal.timeout(WEB_SEARCH_PROVIDER_TIMEOUT_MS);
      const signal = AbortSignal.any([caller_signal, timeout_signal]);
      try {
        const text = await this.search_provider(provider, query, signal);
        signal.throwIfAborted();
        if (this.disposed) throw new AgentToolError({ code: "web_search.unavailable" });
        this.preferred_provider_index = provider_index;
        return { provider: provider.name, text };
      } catch (error) {
        if (caller_signal.aborted) throw caller_signal.reason;
        if (this.disposed) throw new AgentToolError({ code: "web_search.unavailable" });
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
      [...this.clients.keys()].map((provider) => this.close_client(provider)),
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close web search provider connections.");
    }
  }

  /** 仅已携带会话的工具调用 404 才重建；第二次失败也释放会话，预算始终由外层拥有。 */
  private async search_provider(
    spec: SearchProviderSpec,
    query: string,
    signal: AbortSignal,
  ): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      const client = await this.require_client(spec, signal);
      const has_session = client.transport?.sessionId !== undefined; // 记录发送时的会话事实，关闭后 transport 可能清空
      try {
        const result = await client.callTool(
          { name: spec.tool, arguments: spec.create_arguments(query) },
          { signal },
        );
        return read_search_text(spec, result);
      } catch (error) {
        // initialize 协议的取消只发送通知；关闭本地连接才能同时终止尚未返回的 HTTP。
        if (
          signal.aborted ||
          (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)
        ) {
          await this.close_client(spec.name, error);
          throw error;
        }
        if (!(has_session && error instanceof SdkHttpError && error.status === 404)) throw error;
        await this.close_client(spec.name, error);
        if (attempt > 0) throw error;
      }
    }
  }

  /** 延迟创建并登记所有权；默认 initialize 握手与全局 fetch 共用现有供应商及系统代理契约。 */
  private async require_client(spec: SearchProviderSpec, signal: AbortSignal): Promise<Client> {
    signal.throwIfAborted();
    if (this.disposed) throw new AgentToolError({ code: "web_search.unavailable" });
    const existing = this.clients.get(spec.name);
    if (existing !== undefined) return existing;
    const client = new Client({ name: "LinguaGacha", version: this.client_version });
    const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
      requestInit: spec.headers === undefined ? {} : { headers: spec.headers },
    });
    this.clients.set(spec.name, client);
    // 迟到的旧连接关闭通知只能释放自身，不能删除已经替换的新连接。
    client.onclose = () => {
      if (this.clients.get(spec.name) === client) this.clients.delete(spec.name);
    };
    try {
      await client.connect(transport, { signal });
      signal.throwIfAborted();
      return client;
    } catch (error) {
      await this.close_client(spec.name, error);
      throw error;
    }
  }

  /** 先移除拥有的引用再关闭；清理失败时同时保留触发清理的原始原因。 */
  private async close_client(provider: AgentWebSearchProvider, cause?: unknown): Promise<void> {
    const client = this.clients.get(provider);
    this.clients.delete(provider);
    try {
      await client?.close();
    } catch (error) {
      throw new AggregateError(
        cause === undefined ? [error] : [cause, error],
        `Failed to close web search provider ${provider}.`,
      );
    }
  }
}

/** 协议结构由 SDK 校验；业务只接收非空文本并识别供应商自己的失败结果。 */
function read_search_text(spec: SearchProviderSpec, result: CallToolResult): string {
  const text = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter((block) => block !== "")
    .join("\n\n");
  if (result.isError === true) {
    throw new SearchProviderError(
      spec.name,
      "upstream_failed",
      text === "" ? undefined : new Error(text),
    );
  }
  if (text === "") throw new SearchProviderError(spec.name, "empty_result");
  const failure_code = spec.classify_failure?.(text);
  if (failure_code) throw new SearchProviderError(spec.name, failure_code);
  return text;
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
  if (error instanceof SdkHttpError && error.status === 429) {
    return new SearchProviderError(provider, "rate_limited", error);
  }
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
    return new SearchProviderError(provider, "timeout", error);
  }
  return new SearchProviderError(provider, "unavailable", error);
}

/** 固定的非空供应商集合全部失败后汇总；只有原因一致时保留细分错误。 */
function create_search_error(failures: readonly SearchProviderError[]): AgentToolError {
  const first_code = failures[0]!.code;
  const code = failures.every((failure) => failure.code === first_code)
    ? first_code
    : "unavailable";
  return new AgentToolError(
    { code: `web_search.${code}` },
    new AggregateError(failures, "All web search providers failed."),
  );
}
