import {
  stream as pi_ai_stream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";

import { JsonTool } from "../../../shared/utils/json-tool";
import type { ApiJsonValue } from "../../api/api-types";
import {
  convert_linguagacha_model_to_pi_ai,
  type LinguaGachaModelSnapshot,
} from "./linguagacha-model-to-pi-ai";
import {
  build_pi_ai_provider_options,
  patch_linguagacha_payload,
} from "./linguagacha-thinking-policy";
import type {
  LlmRequestBody,
  LlmRequestClient,
  LlmRequestMessage,
  LlmRequestResult,
} from "./llm-request-types";
import { StreamDegradationDetector } from "./stream-degradation-detector";

const SDK_TIMEOUT_BUFFER_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

type PiAiStreamFunction = (
  model: Model<Api>,
  context: Context,
  options?: Record<string, unknown>,
) => AsyncIterable<AssistantMessageEvent>;

interface PiAiLlmRequestClientOptions {
  appRoot: string;
  stream?: PiAiStreamFunction;
  now?: () => number;
}

/**
 * 基于 pi-ai 的 TS LLM 请求客户端，只负责供应商通信和旧请求事实归一。
 */
export class PiAiLlmRequestClient implements LlmRequestClient {
  private readonly app_root: string;
  private readonly stream_fn: PiAiStreamFunction;
  private readonly now: () => number;
  // key_rotation_offsets 只在当前 worker 进程内生效，复刻旧客户端池的本地轮换语义。
  private readonly key_rotation_offsets = new Map<string, number>();

  /**
   * app_root 用于读取版本和资源根；stream_fn 注入点让单测不碰真实网络。
   */
  public constructor(options: PiAiLlmRequestClientOptions) {
    this.app_root = options.appRoot;
    this.stream_fn = options.stream ?? pi_ai_stream;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 执行一次 LLM 请求；失败不会泄出供应商对象，只返回旧 worker 能理解的字段。
   */
  public async request(body: LlmRequestBody, signal: AbortSignal): Promise<LlmRequestResult> {
    const snapshot = convert_linguagacha_model_to_pi_ai(body.model, this.app_root);
    const context = this.build_context(body.messages);
    const controller = new AbortController();
    let cancelled = false;
    let timeout = false;
    let degraded = false;
    const timeout_ms = this.read_request_timeout_ms(body.config_snapshot);
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, timeout_ms);
    const abort_listener = (): void => {
      cancelled = true;
      controller.abort();
    };
    signal.addEventListener("abort", abort_listener, { once: true });

    try {
      if (signal.aborted) {
        return this.empty_result({ cancelled: true });
      }
      const stream_options = this.build_stream_options(snapshot, controller.signal, timeout_ms);
      const collector = new PiAiEventCollector();
      for await (const event of this.stream_fn(snapshot.pi_model, context, stream_options)) {
        collector.consume(event);
        if (collector.degraded) {
          degraded = true;
          controller.abort();
          break;
        }
      }
      if (degraded) {
        return this.empty_result({ degraded: true });
      }
      if (timeout) {
        return this.empty_result({ timeout: true });
      }
      if (cancelled || signal.aborted) {
        return this.empty_result({ cancelled: true });
      }
      return this.build_result(snapshot, collector);
    } catch (error) {
      if (degraded) {
        return this.empty_result({ degraded: true });
      }
      if (timeout) {
        return this.empty_result({ timeout: true });
      }
      if (cancelled || signal.aborted) {
        return this.empty_result({ cancelled: true });
      }
      return this.empty_result({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort_listener);
    }
  }

  /**
   * system 消息合并进 systemPrompt，user 消息保持顺序进入 pi-ai Context。
   */
  private build_context(messages: LlmRequestMessage[]): Context {
    const system_texts: string[] = [];
    const user_messages: Context["messages"] = [];
    for (const message of messages) {
      const content = message.content.trim();
      if (content === "") {
        continue;
      }
      if (message.role === "system") {
        system_texts.push(content);
        continue;
      }
      if (message.role === "user") {
        user_messages.push({ role: "user", content, timestamp: this.now() });
        continue;
      }
      throw new Error(`LLM 请求不支持的消息 role：${message.role}`);
    }
    if (system_texts.length === 0 && user_messages.length === 0) {
      throw new Error("LLM 请求 messages 为空。");
    }
    return {
      systemPrompt: system_texts.length > 0 ? system_texts.join("\n\n") : undefined,
      messages: user_messages,
    };
  }

  /**
   * 传给 pi-ai 的 option 只承载传输和供应商参数，业务重试仍由 TaskEngine 持有。
   */
  private build_stream_options(
    snapshot: LinguaGachaModelSnapshot,
    signal: AbortSignal,
    hard_timeout_ms: number,
  ): Record<string, unknown> {
    const provider_options = build_pi_ai_provider_options(snapshot);
    return {
      ...provider_options,
      apiKey: this.select_api_key(snapshot),
      headers: snapshot.extra_headers,
      signal,
      timeoutMs: hard_timeout_ms + SDK_TIMEOUT_BUFFER_MS,
      maxRetries: 0,
      maxRetryDelayMs: 0,
      cacheRetention: "none",
      onPayload: (payload: unknown) => patch_linguagacha_payload(payload, snapshot),
    };
  }

  /**
   * 同一 worker 内按模型快照的 key 列表 round-robin，空 key 保持 no_key_required。
   */
  private select_api_key(snapshot: LinguaGachaModelSnapshot): string {
    const keys = snapshot.api_keys.length > 0 ? snapshot.api_keys : ["no_key_required"];
    const signature = JsonTool.stringifyStrict({
      api_format: snapshot.api_format,
      api_url: snapshot.api_url,
      model_id: snapshot.model_id,
      keys,
    });
    const offset = this.key_rotation_offsets.get(signature) ?? 0;
    const selected_key = keys[offset % keys.length] ?? "no_key_required";
    this.key_rotation_offsets.set(signature, offset + 1);
    return selected_key;
  }

  /**
   * pi-ai 终态归一回 LinguaGacha 旧响应字段。
   */
  private build_result(
    snapshot: LinguaGachaModelSnapshot,
    collector: PiAiEventCollector,
  ): LlmRequestResult {
    const final_message = collector.final_message;
    if (collector.error_message !== "") {
      return this.empty_result({
        error: collector.error_message,
        input_tokens: final_message?.usage.input ?? 0,
        output_tokens: final_message?.usage.output ?? 0,
      });
    }
    const response_result =
      snapshot.api_format === "SakuraLLM"
        ? this.convert_sakura_response(collector.response_result)
        : collector.response_result;
    const stop_reason = final_message?.stopReason ?? "stop";
    const error =
      stop_reason === "length"
        ? "供应商返回长度截断。"
        : stop_reason === "toolUse"
          ? "供应商返回工具调用，当前任务不支持。"
          : "";
    return {
      response_think: collector.response_think,
      response_result: error === "" ? response_result : "",
      input_tokens: final_message?.usage.input ?? 0,
      output_tokens: final_message?.usage.output ?? 0,
      cancelled: false,
      timeout: false,
      degraded: false,
      error,
    };
  }

  /**
   * SakuraLLM 仍把逐行文本转成 JSON map，再交给既有 ResponseDecoder。
   */
  private convert_sakura_response(response_result: string): string {
    const rows: Record<string, string> = {};
    for (const [index, line] of response_result.trim().split(/\r?\n/u).entries()) {
      rows[String(index)] = line.trim();
    }
    return JsonTool.stringifyStrict(rows);
  }

  /**
   * 超时来自任务启动快照，避免 UI 后续修改影响正在执行的请求。
   */
  private read_request_timeout_ms(config_snapshot: ApiJsonValue): number {
    const record =
      typeof config_snapshot === "object" &&
      config_snapshot !== null &&
      !Array.isArray(config_snapshot)
        ? config_snapshot
        : {};
    const seconds = Number(record["request_timeout"] ?? DEFAULT_REQUEST_TIMEOUT_MS / 1000);
    return Math.max(
      1_000,
      Math.trunc(Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_REQUEST_TIMEOUT_MS),
    );
  }

  /**
   * 空结果集中保留默认字段，调用点只覆盖真实发生的请求事实。
   */
  private empty_result(overrides: Partial<LlmRequestResult> = {}): LlmRequestResult {
    return {
      response_think: "",
      response_result: "",
      input_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
      ...overrides,
    };
  }
}

/**
 * 聚合 pi-ai 事件，按 contentIndex 保持 text/thinking block 的真实顺序。
 */
class PiAiEventCollector {
  private readonly text_blocks = new Map<number, string>();
  private readonly thinking_blocks = new Map<number, string>();
  private readonly degradation_detector = new StreamDegradationDetector();
  public final_message: AssistantMessage | null = null;
  public error_message = "";
  public degraded = false;

  public get response_result(): string {
    return this.join_blocks(this.text_blocks);
  }

  public get response_think(): string {
    return this.join_blocks(this.thinking_blocks);
  }

  /**
   * 消费单个事件；toolcall 被归一为错误，避免任务链路误把工具输出当译文。
   */
  public consume(event: AssistantMessageEvent): void {
    if (event.type === "text_delta") {
      this.append_block(this.text_blocks, event.contentIndex, event.delta);
      if (this.degradation_detector.feed(event.delta)) {
        this.degraded = true;
      }
      return;
    }
    if (event.type === "text_end") {
      this.text_blocks.set(event.contentIndex, event.content);
      if (StreamDegradationDetector.has_output_degradation(event.content)) {
        this.degraded = true;
      }
      return;
    }
    if (event.type === "thinking_delta") {
      this.append_block(this.thinking_blocks, event.contentIndex, event.delta);
      return;
    }
    if (event.type === "thinking_end") {
      this.thinking_blocks.set(event.contentIndex, event.content);
      return;
    }
    if (event.type === "toolcall_start" || event.type === "toolcall_delta") {
      this.error_message = "供应商返回工具调用，当前任务不支持。";
      return;
    }
    if (event.type === "toolcall_end") {
      this.error_message = `供应商返回工具调用：${event.toolCall.name}`;
      return;
    }
    if (event.type === "done") {
      this.final_message = event.message;
      return;
    }
    if (event.type === "error") {
      this.final_message = event.error;
      this.error_message = event.error.errorMessage ?? "供应商请求失败。";
    }
  }

  /**
   * 分块追加必须按 contentIndex 写回，避免交错事件打乱正文与思考块。
   */
  private append_block(blocks: Map<number, string>, content_index: number, delta: string): void {
    blocks.set(content_index, `${blocks.get(content_index) ?? ""}${delta}`);
  }

  /**
   * 拼接时再排序，兼容供应商事件顺序与 block index 不完全一致的情况。
   */
  private join_blocks(blocks: Map<number, string>): string {
    return [...blocks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text)
      .join("")
      .trim();
  }
}
