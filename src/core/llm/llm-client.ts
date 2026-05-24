import { JsonTool } from "../../shared/utils/json-tool";
import { to_error_diagnostic } from "../../shared/error";
import type { ApiJsonValue } from "../api/api-types";
import { LLMClientPolicy } from "./llm-client-policy";
import type { RequestProvider } from "./policy/policy-types";
import type { LLMRequestBody, LLMClientPort, LLMRequestResult } from "./llm-types";
import { AnthropicTransport, create_anthropic_client } from "./transport/anthropic-transport";
import { GoogleTransport, create_google_client } from "./transport/google-transport";
import {
  OpenAICompatibleTransport,
  create_openai_compatible_client,
} from "./transport/openai-compatible-transport";
import { SakuraTransport } from "./transport/sakura-transport";
import type {
  ProviderClientFactory,
  ProviderClientPoolRequest,
  ProviderClientResolver,
  RequestTransport,
} from "./transport/transport-types";

interface LLMClientOptions {
  userAgent: string; // userAgent 由应用元信息层注入，LLMClient 不读取 version.txt
  policy?: LLMClientPolicy; // policy 注入点只供测试替换请求策略，不改变生产归属
  clientPool?: ProviderClientResolver; // clientPool 注入点用于验证 SDK client 复用和凭据隔离
  transports?: Partial<Record<RequestProvider, RequestTransport>>; // transports 只允许按 provider 替换边界实现
}

/**
 * LLMClient 是 Core 进程内 LLM 请求入口，负责 policy、超时、取消和错误归一。
 */
export class LLMClient implements LLMClientPort {
  private readonly policy: LLMClientPolicy; // policy 是请求快照到最终 provider payload 的唯一入口
  private readonly transports: Record<RequestProvider, RequestTransport>; // transports 按 provider 分发表层请求，不再改写模型策略

  /**
   * 构造 Core 进程内 LLM 请求客户端；测试可注入 fake policy、pool 或 transport。
   */
  public constructor(options: LLMClientOptions) {
    const client_pool = options.clientPool ?? new ProviderClientPool();
    this.policy = options.policy ?? new LLMClientPolicy(options.userAgent);
    this.transports = {
      "openai-compatible":
        options.transports?.["openai-compatible"] ?? new OpenAICompatibleTransport(client_pool),
      sakura: options.transports?.sakura ?? new SakuraTransport(client_pool),
      google: options.transports?.google ?? new GoogleTransport(client_pool),
      anthropic: options.transports?.anthropic ?? new AnthropicTransport(client_pool),
    };
  }

  /**
   * 每次请求只解析一次 policy；transport 不再拥有模型族判断或 payload patch 权限。
   */
  public async request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult> {
    const resolved_policy = this.policy.resolve(body);
    const controller = new AbortController();
    let timeout = false;
    let cancelled = false;
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, resolved_policy.timeout_ms);
    const abort_listener = (): void => {
      cancelled = true;
      controller.abort();
    };
    signal.addEventListener("abort", abort_listener, { once: true });
    try {
      if (signal.aborted) {
        return this.empty_result({ cancelled: true });
      }
      return await this.transports[resolved_policy.provider].send(
        resolved_policy,
        controller.signal,
      );
    } catch (error) {
      if (timeout) {
        return this.empty_result({ timeout: true });
      }
      if (cancelled || signal.aborted) {
        return this.empty_result({ cancelled: true });
      }
      const model_id = this.read_model_id(body.model);
      return this.empty_result({
        failure: to_error_diagnostic(error, {
          api_format: resolved_policy.api_format,
          ...(model_id === "" ? {} : { model_id }),
          provider: resolved_policy.provider,
          run_id: body.run_id,
          work_unit_id: body.work_unit_id,
        }),
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort_listener);
    }
  }

  /**
   * 空结果集中保留完整请求事实字段，避免调用方理解异常来源。
   */
  private empty_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
    return {
      response_think: "",
      response_result: "",
      input_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      degraded: false,
      ...overrides,
    };
  }

  /**
   * 模型 ID 是安全诊断值；缺失时不向错误 context 写空字段。
   */
  private read_model_id(value: ApiJsonValue): string {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "";
    }
    const model_id = value["model_id"];
    return typeof model_id === "string" ? model_id : "";
  }
}

/**
 * ProviderClientPool 是 LLMClient 私有的 SDK client 生命周期编排器。
 */
export class ProviderClientPool implements ProviderClientResolver {
  private readonly clients = new Map<string, unknown>(); // clients 的 key 包含 provider/key/header/timeout，避免跨凭据复用
  private readonly factory: ProviderClientFactory; // factory 是 SDK client 创建的唯一委托，pool 不理解各 provider 构造参数
  private create_count = 0; // create_count 只供测试和压测确认 client 复用模型

  /**
   * factory 只供测试注入 fake SDK client，生产路径使用 official SDK factory。
   */
  public constructor(factory: ProviderClientFactory = create_official_sdk_client) {
    this.factory = factory;
  }

  /**
   * 按 provider/key/header 组合取 client；cache miss 时才创建官方 SDK client。
   */
  public get_client<T>(request: ProviderClientPoolRequest): T {
    const key = this.build_key(request);
    const existing = this.clients.get(key);
    if (existing !== undefined) {
      return existing as T;
    }
    const created = this.factory(request);
    this.clients.set(key, created);
    this.create_count += 1;
    return created as T;
  }

  /**
   * 测试读取 client 创建次数，生产链路不依赖这个计数。
   */
  public get_create_count_for_test(): number {
    return this.create_count;
  }

  /**
   * cache key 必须包含凭据和 header 签名，避免跨租户或跨自定义 header 复用。
   */
  private build_key(request: ProviderClientPoolRequest): string {
    return JsonTool.stringifyStrict({
      provider: request.provider,
      api_format: request.api_format,
      base_url: request.base_url,
      api_key: request.api_key,
      timeout_ms: request.timeout_ms,
      headers_signature: JsonTool.stringifyStrict(request.headers),
      auth_mode: request.auth_mode ?? "api-key",
    });
  }
}

/**
 * official SDK client factory 只在请求编排层做 provider 到专属 SDK 构造器的分发。
 */
function create_official_sdk_client(request: ProviderClientPoolRequest): unknown {
  if (request.provider === "google") {
    return create_google_client(request);
  }
  if (request.provider === "anthropic") {
    return create_anthropic_client(request);
  }
  return create_openai_compatible_client(request);
}
