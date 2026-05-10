import { JsonTool } from "../../../shared/utils/json-tool";
import type { ApiJsonValue } from "../../api/api-types";
import type { PyLlmRequestBody, PyLlmRequestResult } from "./llm-request-types";

// worker 创建 LLM adapter 客户端时只接收内部服务地址和认证令牌。
interface PyLlmRequestClientOptions {
  // pyCoreBaseUrl 来自主进程启动参数，worker 不自行发现 Python 服务。
  pyCoreBaseUrl: string;
  // pyCoreToken 是内部 adapter 路由的认证令牌，避免本机端口被误调用。
  pyCoreToken: string;
}

/**
 * Python LLM adapter 的 HTTP 传输错误，TaskEngine 会把它当作可重试 work unit 失败。
 */
export class PyLlmRequestTransportError extends Error {
  public readonly cause_error: unknown;

  /**
   * 记录底层异常对象，TaskEngine 上报时仍能追踪真实 fetch 失败原因。
   */
  public constructor(message: string, cause_error: unknown) {
    super(message);
    this.name = "PyLlmRequestTransportError";
    this.cause_error = cause_error;
  }
}

/**
 * worker 内唯一能访问 Python 内部 LLM adapter 的客户端。
 */
export class PyLlmRequestClient {
  // py_core_base_url 只来自 Electron main 注入，不进入 preload 或 renderer。
  private readonly py_core_base_url: string;

  // py_core_token 是内部路由令牌，所有请求必须携带。
  private readonly py_core_token: string;

  /**
   * 保存内部地址与 token，避免 runner 直接拼 fetch 细节。
   */
  public constructor(options: PyLlmRequestClientOptions) {
    this.py_core_base_url = options.pyCoreBaseUrl.replace(/\/$/u, "");
    this.py_core_token = options.pyCoreToken;
  }

  /**
   * 发送一次原始 LLM 请求；响应体只归一基础字段，不做业务解码。
   */
  public async request(body: PyLlmRequestBody, signal: AbortSignal): Promise<PyLlmRequestResult> {
    const data = await this.post_adapter_json("/internal/llm/request", body, signal);
    return {
      response_think: this.read_string(data["response_think"]),
      response_result: this.read_string(data["response_result"]),
      input_tokens: this.read_number(data["input_tokens"], 0),
      output_tokens: this.read_number(data["output_tokens"], 0),
      cancelled: data["cancelled"] === true,
      timeout: data["timeout"] === true,
      degraded: data["degraded"] === true,
      error: this.read_string(data["error"]),
    };
  }

  /**
   * 内部 adapter 统一使用 POST + JSON 响应壳，失败时保留路径方便排障。
   */
  private async post_adapter_json(
    path_name: string,
    body: PyLlmRequestBody,
    signal: AbortSignal,
  ): Promise<Record<string, ApiJsonValue>> {
    const target_url = `${this.py_core_base_url}${path_name}`;
    let response: Response;
    try {
      response = await fetch(target_url, {
        body: JsonTool.stringifyStrict(body),
        headers: {
          "Content-Type": "application/json",
          "X-LinguaGacha-Core-Token": this.py_core_token,
        },
        method: "POST",
        signal,
      });
    } catch (error) {
      throw new PyLlmRequestTransportError(`Python LLM adapter 网络请求失败：${path_name}`, error);
    }

    const envelope = (await this.read_response_envelope(response, path_name)) as {
      ok?: boolean;
      data?: Record<string, ApiJsonValue>;
      error?: { message?: string };
    };
    if (response.ok && envelope.ok === true) {
      return envelope.data ?? {};
    }
    throw new Error(envelope.error?.message ?? "Python LLM adapter 调用失败。");
  }

  /**
   * 响应读取失败属于传输层问题，应交给任务重试逻辑处理。
   */
  private async read_response_envelope(response: Response, path_name: string): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new PyLlmRequestTransportError(`Python LLM adapter 响应读取失败：${path_name}`, error);
    }
  }

  /**
   * 字符串字段集中归一，避免 undefined 泄入日志或后续解码。
   */
  private read_string(value: ApiJsonValue | undefined): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * token 字段保持非负整数，坏值按默认值兜底。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.max(0, Math.trunc(number_value)) : fallback;
  }
}
