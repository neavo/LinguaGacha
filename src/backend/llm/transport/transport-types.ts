import type { ResolvedRequestPolicy, RequestProvider } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { is_json_record } from "../../../domain/json";

/**
 * ProviderClientPoolRequest 是请求编排器和具体 SDK factory 之间的窄边界。
 */
export interface ProviderClientPoolRequest {
  provider: RequestProvider; // 决定 official SDK factory 的分发目标
  api_format: string; // 保留接入点协议，避免同 baseUrl 被跨协议复用
  base_url: string; // client 连接端点，也是缓存 key 的核心组成
  api_key: string; // 必须参与缓存 key，避免跨凭据复用 client
  timeout_ms: number; // 参与缓存 key，确保 client 超时语义稳定
  headers: Record<string, string>; // 参与缓存 key，承载自定义鉴权和路由语义
  auth_mode?: string; // 区分 api-key、bearer 等 SDK 鉴权形态
}

/**
 * ProviderClientFactory 只负责把池化请求转换为具体 official SDK client。
 */
export type ProviderClientFactory = (request: ProviderClientPoolRequest) => unknown;

/**
 * ProviderClientResolver 是 transport 获取 SDK client 的唯一能力接口。
 */
export interface ProviderClientResolver {
  /**
   * 按请求事实取 SDK client；缓存、创建和凭据隔离都由编排器负责。
   */
  get_client<T>(request: ProviderClientPoolRequest): T;
}

/**
 * RequestTransport 只消费已解析策略并归一供应商流式响应。
 */
export interface RequestTransport {
  /**
   * 使用已解析策略发起一次可取消请求，并返回统一 LLM 结果。
   */
  send(policy: ResolvedRequestPolicy, signal: AbortSignal): Promise<LLMRequestResult>;
}

/**
 * 供应商无输出、取消、超时和退化分支共用完整默认结果。
 */
export function empty_llm_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
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
 * SDK 流事件只允许普通对象进入字段解析。
 */
export function read_transport_record(value: unknown): Record<string, unknown> {
  return is_json_record(value) ? value : {};
}

/**
 * 非字符串 SDK 字段不拼入响应正文或思考文本。
 */
export function read_transport_text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
