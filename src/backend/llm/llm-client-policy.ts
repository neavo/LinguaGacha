import { Model, type ModelApiFormat } from "../../domain/model";
import { normalize_setting_snapshot } from "../../domain/setting";
import { JsonTool } from "../../shared/utils/json-tool";
import type { ApiJsonValue } from "../api/api-types";
import { build_anthropic_payload } from "./policy/anthropic-policy";
import { build_google_payload, normalize_google_sdk_base_url } from "./policy/google-policy";
import {
  build_openai_compatible_payload,
  normalize_openai_compatible_sdk_base_url,
} from "./policy/openai-compatible-policy";
import { build_sakura_payload, normalize_sakura_sdk_base_url } from "./policy/sakura-policy";
import type {
  ModelRequestSnapshot,
  ResolvedRequestPolicy,
  RequestProvider,
} from "./policy/policy-types";
import type { LLMMessage, LLMRequestBody } from "./llm-types";

const DEFAULT_OUTPUT_TOKEN_LIMIT = 4096;

/**
 * LLMClientPolicy 是 LLM client 的请求策略编排器，负责读取快照、选择 provider policy 并产出最终请求事实。
 */
export class LLMClientPolicy {
  private readonly user_agent: string; // 由 AppMetadataService 生成，policy 不读取应用文件

  /**
   * 注入最终 User-Agent，保持 LLM policy 只处理请求策略。
   */
  public constructor(user_agent: string) {
    this.user_agent = user_agent;
  }

  /**
   * 解析请求策略；协议和模型定制规则全部委托给 policy 目录下的专属文件。
   */
  public resolve(body: LLMRequestBody): ResolvedRequestPolicy {
    const snapshot = this.read_request_model_snapshot(body.model);
    const payload = this.build_payload(snapshot, body.messages);
    return {
      provider: snapshot.provider,
      api_format: snapshot.api_format,
      base_url: snapshot.base_url,
      model_id: snapshot.model_id,
      headers: snapshot.headers,
      api_keys: snapshot.api_keys,
      messages: body.messages.map((message) => ({ ...message })),
      payload,
      timeout_ms: this.read_request_timeout_ms(body.config_snapshot),
      response_mode: snapshot.api_format === "SakuraLLM" ? "sakura-lines" : "chat-stream",
      diagnostics: {
        run_id: body.run_id,
        work_unit_id: body.work_unit_id,
        policy_signature: this.build_policy_signature(snapshot),
      },
    };
  }

  /**
   * 模型测试和任务请求复用同一 key 归一规则；任务侧会在 Engine 中预先写入单个租约 key。
   */
  public static collect_api_keys(raw_api_key: string): string[] {
    const keys = raw_api_key
      .split(/\r?\n/u)
      .map((key) => key.trim())
      .filter(Boolean);
    return keys.length > 0 ? keys : ["no_key_required"];
  }

  /**
   * 模型列表查询使用 primary key，不参与任务级 ModelKeyLeasePool 轮换。
   */
  public static get_primary_api_key(raw_api_key: string): string {
    return LLMClientPolicy.collect_api_keys(raw_api_key)[0] ?? "no_key_required";
  }

  /**
   * URL 归一化只按 provider 分发，供应商细则放在各自 policy 模块。
   */
  public static normalize_api_url(url: string, api_format: ModelApiFormat): string {
    if (api_format === "Google") {
      return normalize_google_sdk_base_url(url);
    }
    if (api_format === "SakuraLLM") {
      return normalize_sakura_sdk_base_url(url);
    }
    if (api_format === "OpenAI") {
      return normalize_openai_compatible_sdk_base_url(url);
    }
    return url.trim().replace(/\/+$/u, "");
  }

  /**
   * 按 provider 分发最终 payload 构造，保证同一请求只进入一个策略分支。
   */
  private build_payload(
    snapshot: ModelRequestSnapshot,
    messages: LLMMessage[],
  ): Record<string, unknown> {
    if (snapshot.provider === "google") {
      return build_google_payload(snapshot, messages);
    }
    if (snapshot.provider === "anthropic") {
      return build_anthropic_payload(snapshot, messages);
    }
    if (snapshot.provider === "sakura") {
      return build_sakura_payload(snapshot, messages);
    }
    return build_openai_compatible_payload(snapshot, messages);
  }

  /**
   * 从任务模型 JSON 快照读取 policy 所需字段，避免 transport 直接碰原始配置。
   */
  private read_request_model_snapshot(model: ApiJsonValue): ModelRequestSnapshot {
    const record = this.read_record(model);
    const api_format = Model.normalize_api_format(record["api_format"]);
    const provider = this.resolve_provider(api_format);
    const request = this.read_record(record["request"]);
    const threshold = this.read_record(record["threshold"]);
    const thinking = this.read_record(record["thinking"]);
    const output_token_limit = this.read_number(
      threshold["output_token_limit"],
      DEFAULT_OUTPUT_TOKEN_LIMIT,
    );
    return {
      provider,
      api_format,
      api_keys: LLMClientPolicy.collect_api_keys(String(record["api_key"] ?? "")),
      base_url: LLMClientPolicy.normalize_api_url(String(record["api_url"] ?? ""), api_format),
      model_id: String(record["model_id"] ?? ""),
      headers: this.read_extra_headers(request),
      extra_body: this.read_enabled_record(request, "extra_body", "extra_body_custom_enable"),
      generation: this.read_record(record["generation"]),
      output_token_limit,
      thinking_level: Model.normalize_thinking_level(thinking["level"]),
    };
  }

  /**
   * API 格式到 transport provider 的映射集中在编排边界。
   */
  private resolve_provider(api_format: ModelApiFormat): RequestProvider {
    if (api_format === "Google") {
      return "google";
    }
    if (api_format === "Anthropic") {
      return "anthropic";
    }
    if (api_format === "SakuraLLM") {
      return "sakura";
    }
    return "openai-compatible";
  }

  /**
   * 自定义 header 只有显式开启才合并，默认始终带 LinguaGacha User-Agent。
   */
  private read_extra_headers(request: Record<string, ApiJsonValue>): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.user_agent,
    };
    const extra_headers = this.read_enabled_record(
      request,
      "extra_headers",
      "extra_headers_custom_enable",
    );
    for (const [key, value] of Object.entries(extra_headers)) {
      headers[key] = String(value);
    }
    return headers;
  }

  /**
   * 请求超时来自任务启动快照，运行中设置变更不影响已启动请求。
   */
  private read_request_timeout_ms(config_snapshot: ApiJsonValue): number {
    const seconds = normalize_setting_snapshot(config_snapshot).request_timeout;
    return Math.max(1_000, Math.trunc(seconds * 1000));
  }

  /**
   * 读取带 custom_enable 的对象字段，关闭时返回空对象。
   */
  private read_enabled_record(
    record: Record<string, ApiJsonValue>,
    value_key: string,
    enabled_key: string,
  ): Record<string, ApiJsonValue> {
    if (record[enabled_key] !== true) {
      return {};
    }
    return this.read_record(record[value_key]);
  }

  /**
   * JSON 边界只接受普通对象，数组和 null 都按空对象处理。
   */
  private read_record(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 数字字段在请求边界取整，坏值回退调用点默认值。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 诊断签名只包含会影响传输与请求策略的字段。
   */
  private build_policy_signature(snapshot: ModelRequestSnapshot): string {
    return JsonTool.stringifyStrict({
      provider: snapshot.provider,
      api_format: snapshot.api_format,
      base_url: snapshot.base_url,
      model_id: snapshot.model_id,
      headers: snapshot.headers,
    });
  }
}

/**
 * 自定义数值只有开关为 true 才生效，避免默认 UI 值误入 payload。
 */
export function read_custom_number(
  generation: Record<string, ApiJsonValue>,
  key: string,
): number | null {
  if (generation[`${key}_custom_enable`] !== true) {
    return null;
  }
  const value = Number(generation[key]);
  return Number.isFinite(value) ? value : null;
}

/**
 * generation 字段按 provider 字段名映射，未启用的用户字段不进入 payload。
 */
export function patch_generation_fields(
  payload: Record<string, unknown>,
  generation: Record<string, ApiJsonValue>,
  field_map: Record<string, string>,
): void {
  for (const [source_key, target_key] of Object.entries(field_map)) {
    const value = read_custom_number(generation, source_key);
    if (value !== null) {
      payload[target_key] = value;
    }
  }
}

/**
 * temperature 只在用户显式启用且 provider 规则允许时发送。
 */
export function patch_temperature(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
  options: { allow_thinking_temperature?: boolean } = {},
): void {
  const temperature = read_custom_number(snapshot.generation, "temperature");
  if (temperature === null) {
    return;
  }
  if (options.allow_thinking_temperature !== true && snapshot.thinking_level !== "OFF") {
    return;
  }
  payload["temperature"] = temperature;
}

/**
 * 输出 token 自动值不发送给 OpenAI/Google，Anthropic 保留可用下限。
 */
export function resolve_max_tokens_for_request(
  snapshot: ModelRequestSnapshot,
  options: { auto_value?: number | null } = {},
): number | null {
  if (!is_output_token_limit_auto(snapshot.output_token_limit)) {
    return Math.max(1, snapshot.output_token_limit);
  }
  return options.auto_value ?? null;
}

/**
 * 0 和 -1 都表示输出 token 交给供应商默认策略。
 */
export function is_output_token_limit_auto(value: number): boolean {
  return value === 0 || value === -1;
}
