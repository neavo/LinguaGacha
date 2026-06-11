import type { ApiJsonValue } from "../../../api/api-types";
import {
  TextProcessingConfigTool,
  TextQualitySnapshotTool,
  type TextProcessingConfig,
  type TextQualitySnapshot,
  type TextTaskItemRecord,
} from "../../../../shared/text/text-types";
import {
  TranslationPrePipeline,
  type TranslationPrePipelineContext,
} from "../pipeline/translation-pre-pipeline";
import { TranslationPostPipeline } from "../pipeline/translation-post-pipeline";
import {
  format_translation_actor,
  read_translation_text_srcs,
  resolve_translation_prompt_mode,
  type TranslationActor,
  type TranslationDecodedLine,
  type TranslationLine,
  type TranslationPromptMode,
} from "../translation-line";
import { PromptBuilder } from "../work-unit-prompt-builder";
import { ResponseChecker } from "../response/response-checker";
import { ResponseCleaner } from "../response/response-cleaner";
import { ResponseDecoder } from "../response/response-decoder";
import type { LLMClientPort, LLMRequestResult } from "../../../llm/llm-types";
import type { TranslationWorkUnit, WorkUnitLogEntry } from "../../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../../protocol/work-unit-result";
import { normalize_setting_snapshot } from "../../../../domain/setting";
import { format_i18n_message, resolve_i18n_locale, type LocaleKey } from "../../../../shared/i18n";
import type { LogError } from "../../../../shared/error";

/**
 * worker 边界传入的公共请求字段，全部来自任务启动时的不可变快照。
 */
interface WorkUnitBaseRequest {
  run_id: string; // 用于隔离一次任务运行，worker 不用它访问项目状态
  work_unit_id: string; // chunk 级诊断键，迟到响应和日志都围绕它定位
  model: ApiJsonValue; // / config_snapshot 均来自任务启动快照，避免执行中读取可变全局配置
  config_snapshot: ApiJsonValue;
  quality_snapshot: ApiJsonValue; // 文本后处理与提示词构造的唯一质量规则输入
}

/**
 * 批量翻译 chunk 请求，items 是本 work unit 唯一可回写对象。
 */
interface TranslationWorkUnitRequest extends WorkUnitBaseRequest {
  items: ApiJsonValue; // 本 chunk 的不可变条目快照，worker 修改结果后再回传给 TaskEngine
  precedings?: ApiJsonValue; // 只用于上下文提示词，不参与当前 chunk 的写回
  split_count?: ApiJsonValue; // 以下字段用于调度日志诊断，避免任务诊断信息丢失
  retry_count?: ApiJsonValue;
  token_threshold?: ApiJsonValue;
  is_initial?: ApiJsonValue;
}

/**
 * 翻译 runner 回传给 Engine 的统一结果，提交策略仍由主线程决定。
 */
interface TranslationWorkUnitResult {
  items: TextTaskItemRecord[]; // 只包含本 work unit 处理后的条目快照，由 TaskEngine 统一提交
  row_count: number; // 按日志口径表示本次成功覆盖的输入行数
  input_tokens: number; // token 计数向任务统计累加，不参与业务分支判断
  output_tokens: number;
  stopped: boolean; // 主动取消或 adapter 取消，区别于可重试错误
  logs?: WorkUnitLogEntry[]; // 由主线程统一提交，worker 不直接写日志目标
}

/**
 * 翻译类 work unit runner，完整执行预处理、prompt、LLM、响应解析和后处理
 */
export class TranslationWorkUnitRunner {
  private readonly app_root: string; // 用于读取项目内提示词模板，worker 不依赖当前工作目录
  private readonly llm_client: LLMClientPort; // LLM 请求唯一出口，runner 不直接拼供应商协议细节

  /**
   * app_root 用于读取提示词模板，llm_client 是唯一网络请求出口
   */
  public constructor(app_root: string, llm_client: LLMClientPort) {
    this.app_root = app_root;
    this.llm_client = llm_client;
  }

  /**
   * 执行翻译 unit；提交和重试仍由 TaskDefinition / Engine 决定
   */
  public async execute_unit(
    unit: TranslationWorkUnit,
    signal: AbortSignal,
  ): Promise<WorkUnitExecutionResult> {
    const result = await this.run_translation_chunk(
      {
        run_id: unit.run_id,
        work_unit_id: unit.unit_id,
        model: unit.model,
        config_snapshot: unit.config_snapshot,
        quality_snapshot: unit.quality_snapshot,
        items: unit.payload.items,
        precedings: unit.payload.precedings,
        split_count: unit.diagnostics.split_count,
        retry_count: unit.diagnostics.retry_count,
        token_threshold: unit.diagnostics.token_threshold,
        is_initial: unit.diagnostics.is_initial,
      },
      signal,
    );
    return {
      unit_id: unit.unit_id,
      kind: "translation",
      outcome: result.stopped ? "stopped" : result.row_count > 0 ? "success" : "failed",
      metrics: {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
      },
      output: {
        kind: "translation",
        items: result.items as unknown as ApiJsonValue,
        row_count: result.row_count,
      },
      logs: result.logs ?? [],
    };
  }

  /**
   * 执行普通翻译 chunk；提交和重试仍由 Engine 决定
   */
  private async run_translation_chunk(
    request: TranslationWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const items = this.read_item_list(request.items);
    const precedings = this.read_item_list(request.precedings);
    return this.execute_items(request, items, precedings, signal);
  }

  /**
   * 翻译共享实现负责预处理、LLM 调用、响应解析和后处理。
   */
  private async execute_items(
    request: TranslationWorkUnitRequest,
    items: TextTaskItemRecord[],
    precedings: TextTaskItemRecord[],
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const config = TextProcessingConfigTool.from_api_value(request.config_snapshot);
    const quality_snapshot = TextQualitySnapshotTool.from_api_value(request.quality_snapshot);
    const prepared = await this.prepare_request_data(
      request,
      config,
      quality_snapshot,
      items,
      precedings,
    );
    if (prepared.done) {
      return prepared.result;
    }
    const start_time = Date.now();
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
        start_time,
        console_log: prepared.console_log,
        lines: prepared.lines,
        mode: prepared.mode,
        pipeline_contexts: prepared.pipeline_contexts,
        items,
        stream_degraded: response.degraded,
        request_error: response.request_error,
        request_timeout: response.timeout,
      },
      response,
    );
  }

  /**
   * 预处理每个 item；无可翻译行时直接把原文标为已处理
   */
  private async prepare_request_data(
    request: TranslationWorkUnitRequest,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    items: TextTaskItemRecord[],
    precedings: TextTaskItemRecord[],
  ): Promise<
    | { done: true; result: TranslationWorkUnitResult }
    | {
        done: false;
        lines: TranslationLine[];
        mode: TranslationPromptMode;
        messages: Array<{ role: string; content: string }>;
        console_log: string[];
        pipeline_contexts: TranslationPrePipelineContext[];
      }
  > {
    const samples: string[] = [];
    const pre_pipeline = new TranslationPrePipeline(config, quality_snapshot);
    const pipeline_contexts: TranslationPrePipelineContext[] = [];
    let request_index_start = 0;
    for (const [item_index, item] of items.entries()) {
      const pipeline_context = pre_pipeline.process_item(item, item_index, request_index_start);
      request_index_start += pipeline_context.lines.length;
      pipeline_contexts.push(pipeline_context);
    }
    for (const pipeline_context of pipeline_contexts) {
      samples.push(...pipeline_context.samples);
    }
    const lines = pipeline_contexts.flatMap((pipeline_context) => pipeline_context.lines);
    if (lines.length === 0) {
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
    const api_format = this.resolve_model_api_format(request.model);
    const mode = api_format === "SakuraLLM" ? "text" : resolve_translation_prompt_mode(lines);
    const prompt_result =
      api_format === "SakuraLLM"
        ? prompt_builder.generate_prompt_sakura(read_translation_text_srcs(lines))
        : await prompt_builder.generate_prompt(lines, mode, samples, precedings);
    return {
      done: false,
      lines,
      mode,
      messages: prompt_result.messages,
      console_log: prompt_result.console_log,
      pipeline_contexts,
    };
  }

  /**
   * 解码模型响应、执行校验和后处理，最后只返回已终态的 item 快照
   */
  private async apply_response_data(
    context: {
      config: TextProcessingConfig;
      quality_snapshot: TextQualitySnapshot;
      request: TranslationWorkUnitRequest;
      start_time: number;
      console_log: string[];
      lines: TranslationLine[];
      mode: TranslationPromptMode;
      pipeline_contexts: TranslationPrePipelineContext[];
      items: TextTaskItemRecord[];
      stream_degraded: boolean;
      request_error?: LogError;
      request_timeout: boolean;
    },
    response: LLMRequestResult,
  ): Promise<TranslationWorkUnitResult> {
    const cleaner_result =
      context.request_error === undefined
        ? ResponseCleaner.extract_rule_analysis_from_response(response.response_result)
        : { cleaned_response_result: "", rule_analysis_text: "" };
    const normalized_think = ResponseCleaner.normalize_blank_lines(response.response_think).trim();
    const decoded =
      context.request_error === undefined
        ? await new ResponseDecoder().decode_translation(
            cleaner_result.cleaned_response_result,
            context.mode,
          )
        : [];
    const aligned =
      context.stream_degraded || context.request_timeout || context.request_error !== undefined
        ? { decoded_lines: [], dsts: [], actor_dsts: [] }
        : this.align_decoded_lines(context.lines, decoded);
    const checks = this.build_checks(context, aligned.dsts);
    const logs = this.build_translation_logs({
      checks,
      start_time: context.start_time,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      lines: context.lines,
      dsts: aligned.dsts,
      actor_dsts: aligned.actor_dsts,
      mode: context.mode,
      console_log: context.console_log,
      response_think: normalized_think,
      rule_analysis: cleaner_result.rule_analysis_text,
      response_result: cleaner_result.cleaned_response_result,
      request_error: context.request_error,
      request: context.request,
    });
    let updated_count = 0;
    if (checks.some((check) => check === "NONE")) {
      const decoded_queue = [...aligned.decoded_lines];
      const check_queue = [...checks];
      while (check_queue.length < context.lines.length) {
        check_queue.push("NONE");
      }
      const post_pipeline = new TranslationPostPipeline(context.config, context.quality_snapshot);
      for (let index = 0; index < context.items.length; index += 1) {
        const pipeline_context = context.pipeline_contexts[index];
        const item = context.items[index];
        if (pipeline_context === undefined || item === undefined) {
          continue;
        }
        const length = pipeline_context.lines.length;
        const item_lines = decoded_queue.splice(0, length);
        const item_checks = check_queue.splice(0, length);
        if (item_checks.every((check) => check === "NONE")) {
          const post_result = post_pipeline.process_item(
            pipeline_context,
            item_lines,
            context.mode,
          );
          item.dst = post_result.dst;
          if (Object.prototype.hasOwnProperty.call(post_result, "name_dst")) {
            item.name_dst = post_result.name_dst ?? null;
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
   * 模型响应必须完整覆盖本次请求序号，重复或缺失都交给校验分支处理。
   */
  private align_decoded_lines(
    lines: TranslationLine[],
    decoded_lines: TranslationDecodedLine[],
  ): { decoded_lines: TranslationDecodedLine[]; dsts: string[]; actor_dsts: TranslationActor[] } {
    if (decoded_lines.length !== lines.length) {
      return { decoded_lines: [], dsts: [], actor_dsts: [] };
    }
    const decoded_by_index = new Map<number, TranslationDecodedLine>();
    for (const decoded_line of decoded_lines) {
      if (decoded_by_index.has(decoded_line.request_index)) {
        return { decoded_lines: [], dsts: [], actor_dsts: [] };
      }
      decoded_by_index.set(decoded_line.request_index, decoded_line);
    }
    const aligned: TranslationDecodedLine[] = [];
    for (const line of lines) {
      const decoded_line = decoded_by_index.get(line.request_index);
      if (decoded_line === undefined) {
        return { decoded_lines: [], dsts: [], actor_dsts: [] };
      }
      aligned.push(decoded_line);
    }
    return {
      decoded_lines: aligned,
      dsts: aligned.map((line) => line.text_dst),
      actor_dsts: aligned.map((line) => line.actor_dst),
    };
  }

  /**
   * 构造响应检查结果，超时和退化在这里映射成固定错误
   */
  private build_checks(
    context: {
      config: TextProcessingConfig;
      quality_snapshot: TextQualitySnapshot;
      lines: TranslationLine[];
      pipeline_contexts: TranslationPrePipelineContext[];
      items: TextTaskItemRecord[];
      stream_degraded: boolean;
      request_error?: LogError;
      request_timeout: boolean;
    },
    dsts: string[],
  ): string[] {
    const srcs = read_translation_text_srcs(context.lines);
    if (context.request_error !== undefined) {
      return srcs.map(() => "FAIL_REQUEST");
    }
    if (context.request_timeout) {
      return srcs.map(() => "FAIL_TIMEOUT");
    }
    const first_item = context.items[0];
    const skip_internal_filter_by_line = context.pipeline_contexts.flatMap((pipeline_context) =>
      Array.from(
        { length: pipeline_context.lines.length },
        () => pipeline_context.item?.skip_internal_filter === true,
      ),
    );
    return ResponseChecker.check(
      srcs,
      dsts,
      String(first_item?.text_type ?? "TXT"),
      context.config,
      context.quality_snapshot,
      context.items.length === 1 ? this.read_number(first_item?.retry_count, 0) : 0,
      context.stream_degraded,
      skip_internal_filter_by_line,
    );
  }

  /**
   * 翻译日志固定按思考过程、规则分析、翻译结果和 SRC/DST 对照分段
   */
  private build_translation_logs(context: {
    checks: string[];
    start_time: number;
    input_tokens: number;
    output_tokens: number;
    lines: TranslationLine[];
    dsts: string[];
    actor_dsts: TranslationActor[];
    mode: TranslationPromptMode;
    console_log: string[];
    response_think: string;
    rule_analysis: string;
    response_result: string;
    request_error?: LogError;
    request: TranslationWorkUnitRequest;
  }): WorkUnitLogEntry[] {
    const app_language = this.read_app_language(context.request.config_snapshot);
    const srcs = read_translation_text_srcs(context.lines);
    const elapsed_seconds = ((Date.now() - context.start_time) / 1000).toFixed(2);
    const stats_info = this.t(app_language, "app.log.engine_task_success", {
      CT: context.output_tokens.toString(),
      LINES: srcs.length.toString(),
      PT: context.input_tokens.toString(),
      TIME: elapsed_seconds,
    });
    const log_decision = this.resolve_translation_log_decision(context.checks, app_language);
    const status_info = this.build_task_status_info(context.request, app_language);
    const rows = [stats_info];
    if (log_decision.message !== stats_info) {
      rows.push(log_decision.message);
    }
    if (status_info !== "") {
      rows.push(status_info);
    }
    rows.push(...context.console_log.map((text) => text.trim()).filter(Boolean));
    const response_think_log = context.response_think.trim();
    const rule_analysis_log = ResponseCleaner.normalize_blank_lines(context.rule_analysis).trim();
    const response_result_log = context.response_result.trim();
    if (response_think_log !== "") {
      rows.push(
        `${this.t(app_language, "app.log.engine_task_thinking_process")}\n${response_think_log}`,
      );
    }
    if (rule_analysis_log !== "") {
      rows.push(
        `${this.t(app_language, "app.log.engine_task_rule_analysis")}\n${rule_analysis_log}`,
      );
    }
    if (response_result_log !== "") {
      rows.push(
        `${this.t(app_language, "app.log.translation_task_result")}\n${response_result_log}`,
      );
    }

    const pair_lines: string[] = [];
    const max_length = Math.max(srcs.length, context.dsts.length);
    for (let index = 0; index < max_length; index += 1) {
      pair_lines.push(`[${String(index + 1)}]`);
      pair_lines.push(`SRC: ${srcs[index] ?? ""}`);
      if (context.mode === "actor_text") {
        pair_lines.push(
          `ACTOR_SRC: ${format_translation_actor(context.lines[index]?.actor_src ?? null)}`,
        );
      }
      pair_lines.push(`DST: ${context.dsts[index] ?? ""}`);
      if (context.mode === "actor_text") {
        pair_lines.push(
          `ACTOR_DST: ${format_translation_actor(context.actor_dsts[index] ?? null)}`,
        );
      }
    }
    if (pair_lines.length > 0) {
      rows.push(pair_lines.join("\n"));
    }
    return [
      {
        level: log_decision.level,
        message: `${rows.filter(Boolean).join("\n\n")}\n`,
        ...(context.request_error === undefined ? {} : { error: context.request_error }),
      },
    ];
  }

  /**
   * 拆分 / 重试信息来自 TaskEngine 传入的不可变上下文，日志里保留旧排障口径
   */
  private build_task_status_info(
    request: TranslationWorkUnitRequest,
    app_language: unknown,
  ): string {
    const split_count = this.read_number(request.split_count, 0);
    const retry_count = this.read_number(request.retry_count, 0);
    const token_threshold = this.read_number(request.token_threshold, 0);
    const is_initial = Boolean(request.is_initial ?? true);
    if (is_initial) {
      return "";
    }
    return this.t(app_language, "app.log.translation_task_status_info", {
      RETRY: retry_count.toString(),
      SPLIT: split_count.toString(),
      THRESHOLD: token_threshold.toString(),
    });
  }

  /**
   * 错误码转成稳定中文文本，避免日志窗口只显示内部枚举
   */
  private build_error_reason(checks: string[], app_language: unknown): string {
    const reasons = checks
      .filter((check) => check !== "NONE")
      .map((check) => this.get_error_text(check, app_language))
      .filter(Boolean);
    return [...new Set(reasons)].join("、");
  }

  /**
   * 日志消息与级别沿用旧版 TranslationTask 的分支顺序
   */
  private resolve_translation_log_decision(
    checks: string[],
    app_language: unknown,
  ): { level: WorkUnitLogEntry["level"]; message: string } {
    const reason = this.build_error_reason(checks, app_language);
    const fail = (key: LocaleKey): string =>
      this.t(app_language, key, {
        REASON: reason,
      });
    if (checks.every((check) => check === "FAIL_TIMEOUT")) {
      return {
        level: "error",
        message: this.t(app_language, "app.log.translation_response_check_fail_all", {
          REASON: this.t(app_language, "app.log.response_checker_fail_timeout"),
        }),
      };
    }
    if (checks.every((check) => check === "FAIL_REQUEST")) {
      return { level: "error", message: this.t(app_language, "app.log.request_failed_retry") };
    }
    if (checks.every((check) => check === "FAIL_DEGRADATION")) {
      return { level: "error", message: fail("app.log.translation_response_check_fail_all") };
    }
    if (checks.every((check) => check === "FAIL_DATA")) {
      return { level: "error", message: fail("app.log.translation_response_check_fail") };
    }
    if (checks.every((check) => check === "FAIL_LINE_COUNT")) {
      return { level: "error", message: fail("app.log.translation_response_check_fail") };
    }
    if (checks.every((check) => this.is_line_error(check))) {
      return { level: "error", message: fail("app.log.translation_response_check_fail_all") };
    }
    if (checks.some((check) => this.is_line_error(check))) {
      return { level: "warning", message: fail("app.log.translation_response_check_fail_part") };
    }
    return { level: "info", message: "" };
  }

  /**
   * 迁移前 ResponseChecker 的本地化文案在 worker 内压缩为固定中文诊断
   */
  private get_error_text(check: string, app_language: unknown): string {
    switch (check) {
      case "FAIL_DATA":
        return this.t(app_language, "app.log.response_checker_fail_data");
      case "FAIL_LINE_COUNT":
        return this.t(app_language, "app.log.response_checker_fail_line_count");
      case "FAIL_TIMEOUT":
        return this.t(app_language, "app.log.response_checker_fail_timeout");
      case "LINE_ERROR_EMPTY_LINE":
        return this.t(app_language, "app.log.response_checker_line_error_empty_line");
      case "LINE_ERROR_SIMILARITY":
        return this.t(app_language, "app.log.response_checker_line_error_similarity");
      case "FAIL_DEGRADATION":
        return this.t(app_language, "app.log.response_checker_fail_degradation");
      case "FAIL_REQUEST":
        return this.t(app_language, "app.log.response_checker_fail_request");
      default:
        return check;
    }
  }

  /**
   * 行级错误会降级为部分失败，整包错误会触发整包重试。
   */
  private is_line_error(check: string): boolean {
    return check === "LINE_ERROR_EMPTY_LINE" || check === "LINE_ERROR_SIMILARITY";
  }

  /**
   * 日志本地化只读取任务启动快照，避免执行中语言变更影响同一 work unit。
   */
  private read_app_language(config_snapshot: ApiJsonValue): unknown {
    return normalize_setting_snapshot(config_snapshot).app_language;
  }

  /**
   * worker 内日志使用同一 i18n 入口，保持翻译和分析 runner 文案一致。
   */
  private t(app_language: unknown, key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_i18n_locale(app_language), key, params);
  }

  /**
   * 配置转给 PromptBuilder 时保留语言字段和 UI 语言
   */
  private config_to_prompt_config(
    config: TextProcessingConfig,
    raw_config: ApiJsonValue,
  ): { app_language?: string; source_language: string; target_language: string } {
    const setting_snapshot = normalize_setting_snapshot(raw_config);
    return {
      app_language: setting_snapshot.app_language,
      source_language: config.source_language,
      target_language: config.target_language,
    };
  }

  /**
   * 模型 API 格式缺失时按 OpenAI 处理
   */
  private resolve_model_api_format(model: ApiJsonValue): string {
    return typeof model === "object" && model !== null && !Array.isArray(model)
      ? String(model["api_format"] ?? "OpenAI")
      : "OpenAI";
  }

  /**
   * work unit item 数组只保留普通对象，避免跨线程带入奇怪值
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
   * 数字字段保持整数语义，坏值回退默认值
   */
  private read_number(value: unknown, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 空结果保持字段完整，TaskEngine 不需要理解失败来源
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
