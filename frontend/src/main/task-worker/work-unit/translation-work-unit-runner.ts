import type { ApiJsonValue } from "../../api/api-types";
import { TextProcessor, TextResponseChecker } from "../../../shared/text/text-processor";
import {
  TextProcessingConfigTool,
  TextQualitySnapshotTool,
  type TextProcessingConfig,
  type TextQualitySnapshot,
  type TextTaskItemRecord,
} from "../../../shared/text/text-types";
import { PromptBuilder } from "../prompt/prompt-builder";
import { ResponseCleaner } from "../response/response-cleaner";
import { ResponseDecoder } from "../response/response-decoder";
import type { LlmRequestClient, LlmRequestResult } from "../llm/llm-request-types";
import type {
  RetranslateWorkUnitRequest,
  TranslateSingleWorkUnitRequest,
  TranslateSingleWorkUnitResult,
  TranslationWorkUnitRequest,
  TranslationWorkUnitResult,
  WorkUnitLogEntry,
} from "./work-unit-types";

/**
 * 翻译类 work unit runner，完整执行预处理、prompt、LLM、响应解析和后处理。
 */
export class TranslationWorkUnitRunner {
  // app_root 用于读取项目内提示词模板，worker 不依赖当前工作目录。
  private readonly app_root: string;
  // llm_client 是 LLM 请求唯一出口，runner 不直接拼供应商协议细节。
  private readonly llm_client: LlmRequestClient;

  /**
   * app_root 用于读取提示词模板，llm_client 是唯一网络请求出口。
   */
  public constructor(app_root: string, llm_client: LlmRequestClient) {
    this.app_root = app_root;
    this.llm_client = llm_client;
  }

  /**
   * 执行普通翻译 chunk；提交和重试仍由 TaskEngine 决定。
   */
  public async execute_translation_chunk(
    request: TranslationWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const items = this.read_item_list(request.items);
    const precedings = this.read_item_list(request.precedings);
    return this.execute_items(request, items, precedings, false, signal);
  }

  /**
   * 执行单条重翻，输入形状显式为一个 item。
   */
  public async execute_retranslate_item(
    request: RetranslateWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const item = this.read_item(request.item);
    if (item === null) {
      return this.empty_result();
    }
    return this.execute_items(request, [item], [], false, signal);
  }

  /**
   * 单条翻译不写项目，只返回公开派生工具需要的 `{ success, status, dst }`。
   */
  public async translate_single(
    request: TranslateSingleWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<TranslateSingleWorkUnitResult> {
    const text = String(request.text ?? "").trim();
    if (text === "") {
      throw new Error("待翻译文本不能为空。");
    }
    const item: TextTaskItemRecord = { src: text, dst: "", status: "NONE", text_type: "TXT" };
    const result = await this.execute_items(request, [item], [], true, signal);
    const success = result.row_count > 0;
    return {
      success,
      status: success ? "OK" : "TRANSLATION_FAILED",
      dst: String(item.dst ?? ""),
      logs: result.logs,
    };
  }

  /**
   * 翻译共享实现，skip_response_check 只用于低频单条翻译。
   */
  private async execute_items(
    request:
      | TranslationWorkUnitRequest
      | RetranslateWorkUnitRequest
      | TranslateSingleWorkUnitRequest,
    items: TextTaskItemRecord[],
    precedings: TextTaskItemRecord[],
    skip_response_check: boolean,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const config = TextProcessingConfigTool.from_api_value(request.config_snapshot);
    const quality_snapshot = TextQualitySnapshotTool.from_api_value(request.quality_snapshot);
    const processors = items.map((item) => new TextProcessor(config, item, quality_snapshot));
    const prepared = await this.prepare_request_data(
      request,
      config,
      quality_snapshot,
      items,
      processors,
      precedings,
    );
    if (prepared.done) {
      return prepared.result;
    }
    const response = await this.llm_client.request(
      {
        run_id: request.run_id,
        work_unit_id: request.work_unit_id,
        model: request.model,
        config_snapshot: request.config_snapshot,
        messages: prepared.messages,
      },
      signal,
    );
    if (response.cancelled || signal.aborted) {
      return { ...this.empty_result(), stopped: true };
    }
    return this.apply_response_data(
      {
        config,
        quality_snapshot,
        request,
        start_time: Date.now(),
        console_log: prepared.console_log,
        srcs: prepared.srcs,
        processors,
        items,
        skip_response_check,
        stream_degraded: response.degraded,
        request_timeout: response.timeout,
      },
      response,
    );
  }

  /**
   * 预处理每个 item；无可翻译行时直接把原文标为已处理。
   */
  private async prepare_request_data(
    request:
      | TranslationWorkUnitRequest
      | RetranslateWorkUnitRequest
      | TranslateSingleWorkUnitRequest,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    items: TextTaskItemRecord[],
    processors: TextProcessor[],
    precedings: TextTaskItemRecord[],
  ): Promise<
    | { done: true; result: TranslationWorkUnitResult }
    | {
        done: false;
        srcs: string[];
        messages: Array<{ role: string; content: string }>;
        console_log: string[];
      }
  > {
    const srcs: string[] = [];
    const samples: string[] = [];
    for (const processor of processors) {
      processor.pre_process();
      srcs.push(...processor.srcs);
      samples.push(...processor.samples);
    }
    if (srcs.length === 0) {
      for (const item of items) {
        item.dst = String(item.src ?? "");
        item.status = "PROCESSED";
      }
      return {
        done: true,
        result: {
          items,
          row_count: items.length,
          input_tokens: 0,
          output_tokens: 0,
          stopped: false,
        },
      };
    }
    const prompt_builder = new PromptBuilder(
      this.app_root,
      this.config_to_prompt_config(config, request.config_snapshot),
      quality_snapshot,
    );
    const api_format = this.read_model_api_format(request.model);
    const prompt_result =
      api_format === "SakuraLLM"
        ? prompt_builder.generate_prompt_sakura(srcs)
        : await prompt_builder.generate_prompt(srcs, samples, precedings);
    return {
      done: false,
      srcs,
      messages: prompt_result.messages,
      console_log: prompt_result.console_log,
    };
  }

  /**
   * 解码模型响应、执行校验和后处理，最后只返回已终态的 item 快照。
   */
  private async apply_response_data(
    context: {
      config: TextProcessingConfig;
      quality_snapshot: TextQualitySnapshot;
      request:
        | TranslationWorkUnitRequest
        | RetranslateWorkUnitRequest
        | TranslateSingleWorkUnitRequest;
      start_time: number;
      console_log: string[];
      srcs: string[];
      processors: TextProcessor[];
      items: TextTaskItemRecord[];
      skip_response_check: boolean;
      stream_degraded: boolean;
      request_timeout: boolean;
    },
    response: LlmRequestResult,
  ): Promise<TranslationWorkUnitResult> {
    const cleaner_result = ResponseCleaner.extract_why_from_response(response.response_result);
    const normalized_think = ResponseCleaner.merge_text_blocks(
      ResponseCleaner.normalize_blank_lines(response.response_think).trim(),
      cleaner_result.why_text,
    );
    const decoded = await new ResponseDecoder().decode(cleaner_result.cleaned_response_result);
    const dsts = context.stream_degraded || context.request_timeout ? [] : decoded.translations;
    const checks = this.build_checks(context, dsts);
    const logs = this.build_translation_logs({
      checks,
      start_time: context.start_time,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      srcs: context.srcs,
      dsts,
      console_log: context.console_log,
      response_think: normalized_think,
      response_result: cleaner_result.cleaned_response_result,
      request: context.request,
    });
    let updated_count = 0;
    if (checks.some((check) => check === "NONE")) {
      const dst_queue = [...dsts];
      const check_queue = [...checks];
      while (dst_queue.length < context.srcs.length) {
        dst_queue.push("");
      }
      while (check_queue.length < context.srcs.length) {
        check_queue.push("NONE");
      }
      for (let index = 0; index < context.items.length; index += 1) {
        const processor = context.processors[index];
        const item = context.items[index];
        if (processor === undefined || item === undefined) {
          continue;
        }
        const length = processor.srcs.length;
        const item_dsts = dst_queue.splice(0, length);
        const item_checks = check_queue.splice(0, length);
        if (item_checks.every((check) => check === "NONE")) {
          const processed = processor.post_process(item_dsts);
          item.dst = processed.dst;
          if (processed.name !== null) {
            item.name_dst = processed.name;
          }
          item.status = "PROCESSED";
          updated_count += 1;
        }
      }
    }
    if (
      updated_count === 0 &&
      context.items.length === 1 &&
      checks.some((check) => check !== "NONE")
    ) {
      const item = context.items[0];
      if (item !== undefined) {
        item.retry_count = this.read_number(item.retry_count, 0) + 1;
      }
    }
    return {
      items: context.items,
      row_count: updated_count,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      stopped: false,
      logs,
    };
  }

  /**
   * 构造响应检查结果，超时和退化在这里映射成固定错误。
   */
  private build_checks(
    context: {
      config: TextProcessingConfig;
      quality_snapshot: TextQualitySnapshot;
      srcs: string[];
      items: TextTaskItemRecord[];
      skip_response_check: boolean;
      stream_degraded: boolean;
      request_timeout: boolean;
    },
    dsts: string[],
  ): string[] {
    if (context.request_timeout) {
      return context.srcs.map(() => "FAIL_TIMEOUT");
    }
    if (context.skip_response_check) {
      return dsts.map(() => "NONE");
    }
    const first_item = context.items[0];
    return TextResponseChecker.check(
      context.srcs,
      dsts,
      String(first_item?.text_type ?? "TXT"),
      context.config,
      context.quality_snapshot,
      context.items.length === 1 ? this.read_number(first_item?.retry_count, 0) : 0,
      context.stream_degraded,
    );
  }

  /**
   * 尽量复刻旧 TranslationTask 的 chunk 日志：统计、提示词片段、think/result、SRC/DST 对照都保留。
   */
  private build_translation_logs(context: {
    checks: string[];
    start_time: number;
    input_tokens: number;
    output_tokens: number;
    srcs: string[];
    dsts: string[];
    console_log: string[];
    response_think: string;
    response_result: string;
    request:
      | TranslationWorkUnitRequest
      | RetranslateWorkUnitRequest
      | TranslateSingleWorkUnitRequest;
  }): WorkUnitLogEntry[] {
    const elapsed_seconds = ((Date.now() - context.start_time) / 1000).toFixed(2);
    const stats_info = `任务请求成功，用时 ${elapsed_seconds}s，行数 ${context.srcs.length}，输入 tokens ${context.input_tokens}，输出 tokens ${context.output_tokens}`;
    const reason = this.build_error_reason(context.checks);
    const status_info = this.build_task_status_info(context.request);
    const rows = [stats_info];
    if (reason !== "") {
      rows.push(`响应检查失败：${reason}`);
    }
    if (status_info !== "") {
      rows.push(status_info);
    }
    rows.push(...context.console_log.map((text) => text.trim()).filter(Boolean));
    const response_think_log = context.response_think.trim();
    const response_result_log = context.response_result.trim();
    if (response_think_log !== "") {
      rows.push(`模型思考：\n${response_think_log}`);
    }
    if (response_result_log !== "") {
      rows.push(`模型响应：\n${response_result_log}`);
    }

    const pair_lines: string[] = [];
    const max_length = Math.max(context.srcs.length, context.dsts.length);
    for (let index = 0; index < max_length; index += 1) {
      pair_lines.push(`[${String(index + 1)}]`);
      pair_lines.push(`SRC: ${context.srcs[index] ?? ""}`);
      pair_lines.push(`DST: ${context.dsts[index] ?? ""}`);
    }
    if (pair_lines.length > 0) {
      rows.push(pair_lines.join("\n"));
    }
    return [
      {
        level: this.resolve_log_level(context.checks),
        message: `\n${rows.filter(Boolean).join("\n\n")}\n`,
      },
    ];
  }

  /**
   * 拆分 / 重试信息来自 TaskEngine 传入的不可变上下文，日志里保留旧排障口径。
   */
  private build_task_status_info(
    request:
      | TranslationWorkUnitRequest
      | RetranslateWorkUnitRequest
      | TranslateSingleWorkUnitRequest,
  ): string {
    const split_count = this.read_number("split_count" in request ? request.split_count : 0, 0);
    const retry_count = this.read_number("retry_count" in request ? request.retry_count : 0, 0);
    const token_threshold = this.read_number(
      "token_threshold" in request ? request.token_threshold : 0,
      0,
    );
    if (split_count === 0 && retry_count === 0 && token_threshold === 0) {
      return "";
    }
    return `任务状态：拆分 ${split_count}，重试 ${retry_count}，阈值 ${token_threshold}`;
  }

  /**
   * 错误码转成稳定中文文本，避免日志窗口只显示内部枚举。
   */
  private build_error_reason(checks: string[]): string {
    const reasons = checks
      .filter((check) => check !== "NONE")
      .map((check) => this.get_error_text(check))
      .filter(Boolean);
    return [...new Set(reasons)].join("、");
  }

  /**
   * 日志级别沿用旧口径：全失败是 error，部分行失败是 warning，全部通过是 info。
   */
  private resolve_log_level(checks: string[]): WorkUnitLogEntry["level"] {
    if (checks.every((check) => check === "NONE")) {
      return "info";
    }
    if (checks.some((check) => check === "NONE")) {
      return "warning";
    }
    return "error";
  }

  /**
   * 迁移前 ResponseChecker 的本地化文案在 TS worker 内压缩为固定中文诊断。
   */
  private get_error_text(check: string): string {
    switch (check) {
      case "FAIL_DATA":
        return "响应数据无效";
      case "FAIL_LINE_COUNT":
        return "响应行数不匹配";
      case "FAIL_TIMEOUT":
        return "请求超时";
      case "LINE_ERROR_KANA":
        return "译文残留假名";
      case "LINE_ERROR_HANGEUL":
        return "译文残留谚文";
      case "LINE_ERROR_EMPTY_LINE":
        return "译文空行";
      case "LINE_ERROR_SIMILARITY":
        return "译文与原文过于相似";
      case "FAIL_DEGRADATION":
        return "流式响应退化";
      default:
        return check;
    }
  }

  /**
   * 配置转给 PromptBuilder 时保留语言字段和 UI 语言。
   */
  private config_to_prompt_config(
    config: TextProcessingConfig,
    raw_config: ApiJsonValue,
  ): { app_language?: string; source_language: string; target_language: string } {
    const record =
      typeof raw_config === "object" && raw_config !== null && !Array.isArray(raw_config)
        ? raw_config
        : {};
    return {
      app_language: typeof record["app_language"] === "string" ? record["app_language"] : "ZH",
      source_language: config.source_language,
      target_language: config.target_language,
    };
  }

  /**
   * 模型 API 格式缺失时按 OpenAI 处理。
   */
  private read_model_api_format(model: ApiJsonValue): string {
    return typeof model === "object" && model !== null && !Array.isArray(model)
      ? String(model["api_format"] ?? "OpenAI")
      : "OpenAI";
  }

  /**
   * work unit item 数组只保留普通对象，避免跨线程带入奇怪值。
   */
  private read_item_list(value: ApiJsonValue | undefined): TextTaskItemRecord[] {
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is TextTaskItemRecord =>
              typeof item === "object" && item !== null && !Array.isArray(item),
          )
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * 单个 item 读取失败时返回 null，由调用方转换为空结果。
   */
  private read_item(value: ApiJsonValue | undefined): TextTaskItemRecord | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { ...value }
      : null;
  }

  /**
   * 数字字段保持整数语义，坏值回退默认值。
   */
  private read_number(value: unknown, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 空结果保持字段完整，TaskEngine 不需要理解失败来源。
   */
  private empty_result(): TranslationWorkUnitResult {
    return {
      items: [],
      row_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      stopped: false,
    };
  }
}
