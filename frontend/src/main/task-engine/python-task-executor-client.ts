import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../shared/utils/json-tool";
import type {
  AnalysisWorkUnitResult,
  PythonTaskExecutorBaseRequest,
  TaskItemRecord,
  TranslationWorkUnitResult,
} from "./task-engine-types";

interface PythonTaskExecutorClientOptions {
  pyCoreBaseUrl: string;
  pyCoreToken: string;
}

/**
 * Python executor 已开始但 HTTP 传输失败时使用专门错误，方便任务流水线走可恢复重试。
 */
export class PythonTaskExecutorTransportError extends Error {
  public readonly cause_error: unknown;

  public constructor(message: string, cause_error: unknown) {
    super(message);
    this.name = "PythonTaskExecutorTransportError";
    this.cause_error = cause_error;
  }
}

/**
 * TS Task Engine 调 Python work-unit executor 的唯一客户端。
 */
export class PythonTaskExecutorClient {
  // py_core_base_url 只保存在 main 进程，不能进入 preload 或 renderer。
  private readonly py_core_base_url: string;

  // py_core_token 是内部受保护路由令牌，所有 executor 请求都必须携带。
  private readonly py_core_token: string;

  /**
   * 初始化 Python executor 地址和 token，避免 runner 散落 fetch 细节。
   */
  public constructor(options: PythonTaskExecutorClientOptions) {
    this.py_core_base_url = options.pyCoreBaseUrl;
    this.py_core_token = options.pyCoreToken;
  }

  /**
   * 执行单个翻译 chunk；Python 只返回 work-unit 结果，不拥有任务终态。
   */
  public async execute_translation_chunk(
    body: PythonTaskExecutorBaseRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const data = await this.post_executor_json(
      "/internal/task-executor/translation-chunk",
      body,
      signal,
    );
    return this.normalize_translation_result(data);
  }

  /**
   * 执行单个分析 chunk；checkpoint 和候选提交仍由 TS runner 决定。
   */
  public async execute_analysis_chunk(
    body: PythonTaskExecutorBaseRequest,
    signal: AbortSignal,
  ): Promise<AnalysisWorkUnitResult> {
    const data = await this.post_executor_json(
      "/internal/task-executor/analysis-chunk",
      body,
      signal,
    );
    return {
      success: data["success"] === true,
      stopped: data["stopped"] === true,
      input_tokens: this.read_number(data["input_tokens"], 0),
      output_tokens: this.read_number(data["output_tokens"], 0),
      glossary_entries: this.normalize_record_list(data["glossary_entries"]),
    };
  }

  /**
   * 执行单条重翻 item，TS 仍负责队列、提交和行级 busy patch。
   */
  public async execute_retranslate_item(
    body: PythonTaskExecutorBaseRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const data = await this.post_executor_json(
      "/internal/task-executor/retranslate-item",
      body,
      signal,
    );
    return this.normalize_translation_result(data);
  }

  /**
   * 单条翻译使用同一 executor 边界，但不占用后台任务全局锁。
   */
  public async translate_single(
    body: PythonTaskExecutorBaseRequest,
    signal: AbortSignal,
  ): Promise<Record<string, ApiJsonValue>> {
    return this.post_executor_json("/internal/task-executor/translate-single", body, signal);
  }

  /**
   * 统一 POST 内部 executor 路由并校验响应壳。
   */
  private async post_executor_json(
    path_name: string,
    body: Record<string, ApiJsonValue>,
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
      throw new PythonTaskExecutorTransportError(
        `Python work-unit executor 网络请求失败：${path_name}`,
        error,
      );
    }
    const envelope = (await this.read_response_envelope(response, path_name)) as {
      ok?: boolean;
      data?: Record<string, ApiJsonValue>;
      error?: { message?: string };
    };
    if (response.ok && envelope.ok === true) {
      return envelope.data ?? {};
    }
    throw new Error(envelope.error?.message ?? "Python work-unit executor 调用失败。");
  }

  /**
   * 响应体读取失败通常表示 Python 连接中途断开，要交给任务层按传输失败重试。
   */
  private async read_response_envelope(response: Response, path_name: string): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new PythonTaskExecutorTransportError(
        `Python work-unit executor 响应读取失败：${path_name}`,
        error,
      );
    }
  }

  /**
   * 翻译类响应的归一口径集中在客户端，runner 只消费稳定字段。
   */
  private normalize_translation_result(
    data: Record<string, ApiJsonValue>,
  ): TranslationWorkUnitResult {
    return {
      items: this.normalize_record_list(data["items"]),
      row_count: this.read_number(data["row_count"], 0),
      input_tokens: this.read_number(data["input_tokens"], 0),
      output_tokens: this.read_number(data["output_tokens"], 0),
      stopped: data["stopped"] === true,
    };
  }

  /**
   * JSON 数组只保留普通对象元素，避免坏 executor 载荷污染提交层。
   */
  private normalize_record_list(value: ApiJsonValue | undefined): TaskItemRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is Record<string, ApiJsonValue> => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({ ...item }));
  }

  /**
   * 数字字段保持整数语义，坏值由调用方默认值兜底。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }
}
