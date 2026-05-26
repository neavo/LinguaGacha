import type { ApiJsonValue } from "../../../api/api-types";
import { TextQualitySnapshotTool } from "../../../../shared/text/text-types";
import { AnalysisPostPipeline } from "../pipeline/analysis-post-pipeline";
import {
  AnalysisPrePipeline,
  type AnalysisItemContext,
  type AnalysisTaskContext,
} from "../pipeline/analysis-pre-pipeline";
import { PromptBuilder } from "../prompt/prompt-builder";
import { ResponseCleaner } from "../response/response-cleaner";
import { ResponseDecoder } from "../response/response-decoder";
import type { LLMClientPort } from "../../../llm/llm-types";
import type { AnalysisWorkUnit, WorkUnitLogEntry } from "../../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../../protocol/work-unit-result";
import { format_i18n_message, resolve_i18n_locale, type LocaleKey } from "../../../../shared/i18n";
import { normalize_setting_snapshot } from "../../../../base/setting";
import type { LogError } from "../../../../shared/error";

interface AnalysisWorkUnitRequest {
  run_id: string; // run_id 用于隔离一次任务运行，worker 不用它访问项目状态
  work_unit_id: string; // work_unit_id 是 chunk 级诊断键，迟到响应和日志都围绕它定位
  task_type: "analysis"; // task_type 保留 TaskEngine 语义，便于日志与错误回传分类
  model: ApiJsonValue; // model / config_snapshot 均来自任务启动快照，避免执行中读取可变全局配置
  config_snapshot: ApiJsonValue;
  quality_snapshot: ApiJsonValue; // quality_snapshot 是文本后处理与提示词构造的唯一质量规则输入
  context: ApiJsonValue; // context 包含分析 chunk 所需候选、语言和术语上下文，worker 只消费快照输入
}

interface AnalysisWorkUnitResult {
  success: boolean; // success 表示分析解码出了可提交候选或合法空结果
  stopped: boolean; // stopped 表示主动取消，TaskEngine 不应把它当作失败重试
  input_tokens: number; // token 计数与翻译结果同源，用于任务统计
  output_tokens: number;
  glossary_entries: Array<Record<string, ApiJsonValue>>; // glossary_entries 是已归一的候选池输入，checkpoint 仍由 TaskEngine 生成
  logs?: WorkUnitLogEntry[]; // logs 只承载诊断文本，不包含可变业务对象
}

/**
 * 分析 work unit runner，负责 prompt、LLM 请求和候选术语归一
 */
export class AnalysisWorkUnitRunner {
  private readonly app_root: string; // app_root 只用于读取分析提示词模板，runner 不依赖进程 cwd
  private readonly llm_client: LLMClientPort; // llm_client 是分析链路唯一外部调用口，便于取消和错误统一处理

  /**
   * 只注入资源根和 LLM 客户端，runner 不接触数据库或事件
   */
  public constructor(app_root: string, llm_client: LLMClientPort) {
    this.app_root = app_root;
    this.llm_client = llm_client;
  }

  /**
   * 执行分析 unit；checkpoint 状态由 TaskDefinition / Engine 根据 output 生成
   */
  public async execute_unit(
    unit: AnalysisWorkUnit,
    signal: AbortSignal,
  ): Promise<WorkUnitExecutionResult> {
    const result = await this.run_analysis_chunk(
      {
        run_id: unit.run_id,
        work_unit_id: unit.unit_id,
        task_type: "analysis",
        model: unit.model,
        config_snapshot: unit.config_snapshot,
        quality_snapshot: unit.quality_snapshot,
        context: {
          file_path: unit.payload.file_path,
          items: unit.payload.items,
          retry_count: unit.diagnostics.retry_count,
        },
      },
      signal,
    );
    return {
      unit_id: unit.unit_id,
      kind: "analysis",
      outcome: result.stopped ? "stopped" : result.success ? "success" : "failed",
      metrics: {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
      },
      output: {
        kind: "analysis",
        glossary_entries: result.glossary_entries as ApiJsonValue,
        valid_empty_result: result.success && result.glossary_entries.length === 0,
      },
      logs: result.logs ?? [],
    };
  }

  /**
   * 执行单个分析 chunk；checkpoint 状态由 Engine 根据 success 生成
   */
  private async run_analysis_chunk(
    request: AnalysisWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<AnalysisWorkUnitResult> {
    const context = this.read_context(request.context);
    const quality_snapshot = TextQualitySnapshotTool.from_api_value(request.quality_snapshot);
    const prepared = new AnalysisPrePipeline().process_context(context);
    if (prepared.prompt_srcs.length === 0) {
      return {
        success: true,
        stopped: false,
        input_tokens: 0,
        output_tokens: 0,
        glossary_entries: [],
      };
    }
    const prompt_builder = new PromptBuilder(
      this.app_root,
      this.config_to_prompt_config(request.config_snapshot),
      quality_snapshot,
    );
    const prompt_result = await prompt_builder.generate_glossary_prompt(prepared.request_srcs);
    const start_time = Date.now();
    const llm_result = await this.llm_client.request(
      {
        run_id: request.run_id,
        work_unit_id: request.work_unit_id,
        model: request.model,
        config_snapshot: request.config_snapshot,
        messages: prompt_result.messages,
      },
      signal,
    );
    if (llm_result.cancelled || signal.aborted) {
      return {
        success: false,
        stopped: true,
        input_tokens: 0,
        output_tokens: 0,
        glossary_entries: [],
      };
    }
    if (llm_result.timeout || llm_result.degraded || llm_result.request_error !== undefined) {
      const app_language = this.read_app_language(request.config_snapshot);
      const status_text = llm_result.timeout
        ? this.t(app_language, "app.log.response_checker_fail_timeout")
        : llm_result.degraded
          ? this.t(app_language, "app.log.response_checker_fail_degradation")
          : this.t(app_language, "app.log.request_failed_retry");
      return {
        success: false,
        stopped: false,
        input_tokens: llm_result.input_tokens,
        output_tokens: llm_result.output_tokens,
        glossary_entries: [],
        logs: this.build_analysis_logs({
          start_time,
          input_tokens: llm_result.input_tokens,
          output_tokens: llm_result.output_tokens,
          srcs: prepared.prompt_srcs,
          glossary_entries: [],
          response_think: llm_result.response_think,
          rule_analysis: "",
          status_text,
          request_error: llm_result.request_error,
          app_language,
          level: "warning",
        }),
      };
    }
    const cleaner_result = ResponseCleaner.extract_rule_analysis_from_response(
      llm_result.response_result,
    );
    const normalized_think = ResponseCleaner.normalize_blank_lines(
      llm_result.response_think,
    ).trim();
    const decoded = await new ResponseDecoder().decode(cleaner_result.cleaned_response_result);
    const normalized_entries = new AnalysisPostPipeline(
      prepared.fake_name_injector,
    ).normalize_glossary_entries(decoded.glossary_entries);
    if (
      normalized_entries.length === 0 &&
      !ResponseCleaner.has_rule_analysis_block(llm_result.response_result)
    ) {
      return {
        success: false,
        stopped: false,
        input_tokens: llm_result.input_tokens,
        output_tokens: llm_result.output_tokens,
        glossary_entries: [],
        logs: this.build_analysis_logs({
          start_time,
          input_tokens: llm_result.input_tokens,
          output_tokens: llm_result.output_tokens,
          srcs: prepared.prompt_srcs,
          glossary_entries: [],
          response_think: normalized_think,
          rule_analysis: cleaner_result.rule_analysis_text,
          status_text: this.t(
            this.read_app_language(request.config_snapshot),
            "app.log.response_checker_fail_data",
          ),
          app_language: this.read_app_language(request.config_snapshot),
          level: "warning",
        }),
      };
    }
    return {
      success: true,
      stopped: false,
      input_tokens: llm_result.input_tokens,
      output_tokens: llm_result.output_tokens,
      glossary_entries: normalized_entries as Array<Record<string, ApiJsonValue>>,
      logs: this.build_analysis_logs({
        start_time,
        input_tokens: llm_result.input_tokens,
        output_tokens: llm_result.output_tokens,
        srcs: prepared.prompt_srcs,
        glossary_entries: normalized_entries,
        response_think: normalized_think,
        rule_analysis: cleaner_result.rule_analysis_text,
        status_text: "",
        app_language: this.read_app_language(request.config_snapshot),
        level: "info",
      }),
    };
  }

  /**
   * 分析日志固定按思考过程、规则分析、分析输入和分析结果分段
   */
  private build_analysis_logs(context: {
    start_time: number;
    input_tokens: number;
    output_tokens: number;
    srcs: string[];
    glossary_entries: Array<Record<string, ApiJsonValue>>;
    response_think: string;
    rule_analysis: string;
    status_text: string;
    request_error?: LogError;
    app_language: unknown;
    level: WorkUnitLogEntry["level"];
  }): WorkUnitLogEntry[] {
    const elapsed_seconds = ((Date.now() - context.start_time) / 1000).toFixed(2);
    const rows = [
      this.t(context.app_language, "app.log.engine_task_success", {
        CT: context.output_tokens.toString(),
        LINES: context.srcs.length.toString(),
        PT: context.input_tokens.toString(),
        TIME: elapsed_seconds,
      }),
    ];
    if (context.status_text !== "") {
      rows.push(context.status_text);
    }
    const response_think_log = ResponseCleaner.normalize_blank_lines(context.response_think).trim();
    const rule_analysis_log = ResponseCleaner.normalize_blank_lines(context.rule_analysis).trim();
    if (response_think_log !== "") {
      rows.push(
        `${this.t(context.app_language, "app.log.engine_task_thinking_process")}\n${response_think_log}`,
      );
    }
    if (rule_analysis_log !== "") {
      rows.push(
        `${this.t(context.app_language, "app.log.engine_task_rule_analysis")}\n${rule_analysis_log}`,
      );
    }

    const source_lines = context.srcs
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => `SRC: ${text}`);
    if (source_lines.length > 0) {
      rows.push(
        `${this.t(context.app_language, "app.log.analysis_task_source_texts")}\n${source_lines.join("\n")}`,
      );
    }

    const term_lines = this.build_glossary_log_lines(context.glossary_entries);
    rows.push(
      `${this.t(context.app_language, "app.log.analysis_task_result")}\n${
        term_lines.length > 0
          ? term_lines.join("\n")
          : this.t(context.app_language, "app.log.analysis_task_no_terms")
      }`,
    );
    return [
      {
        level: context.level,
        message: `${rows.filter(Boolean).join("\n\n")}\n`,
        ...(context.request_error === undefined ? {} : { error: context.request_error }),
      },
    ];
  }

  /**
   * 术语展示文本统一收口，避免文件日志和控制台展示内容跑偏
   */
  private build_glossary_log_lines(entries: Array<Record<string, ApiJsonValue>>): string[] {
    const rows: string[] = [];
    for (const entry of entries) {
      const src = String(entry["src"] ?? "").trim();
      const dst = String(entry["dst"] ?? "").trim();
      const info = String(entry["info"] ?? "").trim();
      if (src === "" || dst === "") {
        continue;
      }
      rows.push(info === "" ? `TERM: ${src} -> ${dst}` : `TERM: ${src} -> ${dst} #${info}`);
    }
    return rows;
  }

  // read_app_language 封装类内部的非显然分支，避免调用方重复理解同一约束。
  private read_app_language(config_snapshot: ApiJsonValue): unknown {
    return normalize_setting_snapshot(config_snapshot).app_language;
  }

  // t 封装类内部的非显然分支，避免调用方重复理解同一约束。
  private t(app_language: unknown, key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_i18n_locale(app_language), key, params);
  }

  /**
   * 上游 context 是 JSON，worker 在边界处归一成只读值对象
   */
  private read_context(value: ApiJsonValue | undefined): AnalysisTaskContext {
    const record =
      typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    const items_value = record["items"];
    const items: AnalysisItemContext[] = Array.isArray(items_value)
      ? items_value
          .filter(
            (item): item is Record<string, ApiJsonValue> =>
              typeof item === "object" && item !== null && !Array.isArray(item),
          )
          .map((item) => ({
            item_id: this.read_number(item["item_id"], 0),
            file_path: String(item["file_path"] ?? ""),
            src_text: String(item["src_text"] ?? ""),
            first_name_src:
              typeof item["first_name_src"] === "string" ? item["first_name_src"] : null,
          }))
      : [];
    return {
      file_path: String(record["file_path"] ?? ""),
      retry_count: this.read_number(record["retry_count"], 0),
      items,
    };
  }

  /**
   * PromptBuilder 只需要语言字段，缺失时使用默认值
   */
  private config_to_prompt_config(raw_config: ApiJsonValue): {
    app_language?: string;
    source_language?: string;
    target_language?: string;
  } {
    const config = normalize_setting_snapshot(raw_config);
    return {
      app_language: config.app_language,
      source_language: config.source_language,
      target_language: config.target_language,
    };
  }

  /**
   * 数字读取按整数兜底，避免坏 JSON 打断整个 worker
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }
}
