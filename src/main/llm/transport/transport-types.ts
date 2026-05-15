import type { ResolvedRequestPolicy, RequestProvider } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";

/**
 * ProviderClientPoolRequest 是请求编排器和具体 SDK factory 之间的窄边界。
 */
export interface ProviderClientPoolRequest {
  provider: RequestProvider; // provider 决定 official SDK factory 的分发目标
  api_format: string; // api_format 保留接入点协议，避免同 baseUrl 被跨协议复用
  base_url: string; // base_url 是 client 连接端点，也是缓存 key 的核心组成
  api_key: string; // api_key 必须参与缓存 key，避免跨凭据复用 client
  timeout_ms: number; // timeout_ms 参与缓存 key，确保 client 超时语义稳定
  headers: Record<string, string>; // headers 参与缓存 key，承载自定义鉴权和路由语义
  auth_mode?: string; // auth_mode 区分 api-key、bearer 等 SDK 鉴权形态
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
  send(policy: ResolvedRequestPolicy, signal: AbortSignal): Promise<LLMRequestResult>;
}
