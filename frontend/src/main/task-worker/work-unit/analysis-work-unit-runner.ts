import type { ApiJsonValue } from "../../api/api-types";
import { TextProcessor } from "../../../shared/text/text-processor";
import { TextQualitySnapshotTool } from "../../../shared/text/text-types";
import { TextTool } from "../../../shared/utils/text-tool";
import { PromptBuilder } from "../prompt/prompt-builder";
import { ResponseCleaner } from "../response/response-cleaner";
import { ResponseDecoder } from "../response/response-decoder";
import type { PyLlmRequestClient } from "../llm/py-llm-request-client";
import type {
  AnalysisWorkUnitRequest,
  AnalysisWorkUnitResult,
  WorkUnitLogEntry,
} from "./work-unit-types";
import { AnalysisFakeNameInjector } from "./analysis-fake-name-injector";

// 分析 item 上下文只携带 prompt 与 checkpoint 必需字段，避免 worker 持有完整数据库行。
interface AnalysisItemContext {
  item_id: number;
  file_path: string;
  src_text: string;
  first_name_src: string | null;
}

// 一个分析 chunk 的执行上下文，file_path 用于日志聚合，retry_count 用于任务诊断。
interface AnalysisTaskContext {
  file_path: string;
  retry_count: number;
  items: AnalysisItemContext[];
}

/**
 * 分析 work unit runner，负责 prompt、LLM 请求和候选术语归一。
 */
export class AnalysisWorkUnitRunner {
  // app_root 只用于读取分析提示词模板，runner 不依赖进程 cwd。
  private readonly app_root: string;
  // llm_client 是分析链路唯一外部调用口，便于取消和错误统一处理。
  private readonly llm_client: PyLlmRequestClient;

  /**
   * 只注入资源根和 LLM 客户端，runner 不接触数据库或事件。
   */
  public constructor(app_root: string, llm_client: PyLlmRequestClient) {
    this.app_root = app_root;
    this.llm_client = llm_client;
  }

  /**
   * 执行单个分析 chunk；checkpoint 状态由 TaskEngine 根据 success 生成。
   */
  public async execute_analysis_chunk(
    request: AnalysisWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<AnalysisWorkUnitResult> {
    const context = this.read_context(request.context);
    const quality_snapshot = TextQualitySnapshotTool.from_api_value(request.quality_snapshot);
    const prompt_srcs = this.build_prompt_source_texts(context.items);
    if (prompt_srcs.length === 0) {
      return {
        success: true,
        stopped: false,
        input_tokens: 0,
        output_tokens: 0,
        glossary_entries: [],
      };
    }
    const fake_name_injector = new AnalysisFakeNameInjector(prompt_srcs);
    const request_srcs = fake_name_injector.inject_texts(prompt_srcs);
    const prompt_builder = new PromptBuilder(
      this.app_root,
      this.config_to_prompt_config(request.config_snapshot),
      quality_snapshot,
    );
    const prompt_result = await prompt_builder.generate_glossary_prompt(request_srcs);
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
    if (llm_result.timeout || llm_result.degraded || llm_result.error !== "") {
      const status_text = llm_result.timeout
        ? "请求超时"
        : llm_result.degraded
          ? "流式响应退化"
          : `请求失败：${llm_result.error}`;
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
          srcs: prompt_srcs,
          glossary_entries: [],
          response_think: llm_result.response_think,
          response_result: llm_result.response_result,
          status_text,
          level: "warning",
        }),
      };
    }
    const cleaner_result = ResponseCleaner.extract_why_from_response(llm_result.response_result);
    const normalized_think = ResponseCleaner.merge_text_blocks(
      ResponseCleaner.normalize_blank_lines(llm_result.response_think).trim(),
      cleaner_result.why_text,
    );
    const decoded = await new ResponseDecoder().decode(cleaner_result.cleaned_response_result);
    const normalized_entries = this.normalize_glossary_entries(
      decoded.glossary_entries,
      fake_name_injector,
    );
    if (
      normalized_entries.length === 0 &&
      !ResponseCleaner.has_why_block(llm_result.response_result)
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
          srcs: prompt_srcs,
          glossary_entries: [],
          response_think: normalized_think,
          response_result: cleaner_result.cleaned_response_result,
          status_text: "响应数据无效",
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
        srcs: prompt_srcs,
        glossary_entries: normalized_entries,
        response_think: normalized_think,
        response_result: cleaner_result.cleaned_response_result,
        status_text: "",
        level: "info",
      }),
    };
  }

  /**
   * 分析输入沿用翻译姓名前缀注入，但不改变上下文快照。
   */
  private build_prompt_source_texts(items: AnalysisItemContext[]): string[] {
    const prompt_srcs: string[] = [];
    for (const item of items) {
      const src_text = item.src_text.trim();
      if (src_text === "") {
        continue;
      }
      prompt_srcs.push(...TextProcessor.inject_name([src_text], item.first_name_src));
    }
    return prompt_srcs;
  }

  /**
   * 模型术语输出归一成固定 `src/dst/info/case_sensitive` 结构。
   */
  private normalize_glossary_entries(
    glossary_entries: Array<Record<string, string>>,
    fake_name_injector: AnalysisFakeNameInjector,
  ): Array<Record<string, ApiJsonValue>> {
    const normalized: Array<Record<string, ApiJsonValue>> = [];
    for (const raw of glossary_entries) {
      let src = String(raw.src ?? "").trim();
      let dst = String(raw.dst ?? "").trim();
      const restored = fake_name_injector.restore_glossary_entry(src, dst);
      if (restored === null) {
        continue;
      }
      [src, dst] = restored;
      const info = String(raw.info ?? "").trim();
      if (AnalysisFakeNameInjector.is_control_code_self_mapping(src, dst)) {
        normalized.push(this.build_glossary_entry(src, dst, info));
        continue;
      }
      for (const [src_part, dst_part] of this.split_glossary_entry_pairs(src, dst)) {
        const normalized_src = src_part.trim();
        const normalized_dst = dst_part.trim();
        if (normalized_src === "" || normalized_dst === "") {
          continue;
        }
        if (normalized_src === normalized_dst) {
          continue;
        }
        normalized.push(this.build_glossary_entry(normalized_src, normalized_dst, info));
      }
    }
    return normalized;
  }

  /**
   * 复合术语按标点和空格拆分，源译分段数量不同时保留原整项。
   */
  private split_glossary_entry_pairs(src: string, dst: string): Array<[string, string]> {
    const src_parts = TextTool.split_by_punctuation(src, true);
    const dst_parts = TextTool.split_by_punctuation(dst, true);
    if (src_parts.length !== dst_parts.length) {
      return [[src, dst]];
    }
    return src_parts.map((src_part, index) => [src_part, dst_parts[index] ?? ""]);
  }

  /**
   * 候选术语结构统一在这里生成。
   */
  private build_glossary_entry(
    src: string,
    dst: string,
    info: string,
  ): Record<string, ApiJsonValue> {
    return { src, dst, info, case_sensitive: false };
  }

  /**
   * 尽量复刻旧 Py AnalysisTask 的 chunk 日志：统计、原文、think/result 与术语候选同屏输出。
   */
  private build_analysis_logs(context: {
    start_time: number;
    input_tokens: number;
    output_tokens: number;
    srcs: string[];
    glossary_entries: Array<Record<string, ApiJsonValue>>;
    response_think: string;
    response_result: string;
    status_text: string;
    level: WorkUnitLogEntry["level"];
  }): WorkUnitLogEntry[] {
    const elapsed_seconds = ((Date.now() - context.start_time) / 1000).toFixed(2);
    const rows = [
      `任务请求成功，用时 ${elapsed_seconds}s，行数 ${context.srcs.length}，输入 tokens ${context.input_tokens}，输出 tokens ${context.output_tokens}`,
    ];
    if (context.status_text !== "") {
      rows.push(context.status_text);
    }
    const response_think_log = ResponseCleaner.normalize_blank_lines(context.response_think).trim();
    const response_result_log = context.response_result.trim();
    if (response_think_log !== "") {
      rows.push(`模型思考：\n${response_think_log}`);
    }
    if (response_result_log !== "") {
      rows.push(`模型响应：\n${response_result_log}`);
    }

    const source_lines = context.srcs
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => `SRC: ${text}`);
    if (source_lines.length > 0) {
      rows.push(`分析原文：\n${source_lines.join("\n")}`);
    }

    const term_lines = this.build_glossary_log_lines(context.glossary_entries);
    rows.push(`提取术语：\n${term_lines.length > 0 ? term_lines.join("\n") : "未提取到术语"}`);
    return [{ level: context.level, message: `\n${rows.filter(Boolean).join("\n\n")}\n` }];
  }

  /**
   * 术语展示文本统一收口，避免文件日志和控制台展示内容跑偏。
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

  /**
   * 上游 context 是 JSON，worker 在边界处归一成只读值对象。
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
   * PromptBuilder 只需要语言字段，缺失时使用默认值。
   */
  private config_to_prompt_config(raw_config: ApiJsonValue): {
    app_language?: string;
    source_language?: string;
    target_language?: string;
  } {
    const record =
      typeof raw_config === "object" && raw_config !== null && !Array.isArray(raw_config)
        ? raw_config
        : {};
    return {
      app_language: typeof record["app_language"] === "string" ? record["app_language"] : "ZH",
      source_language:
        typeof record["source_language"] === "string" ? record["source_language"] : "JA",
      target_language:
        typeof record["target_language"] === "string" ? record["target_language"] : "ZH",
    };
  }

  /**
   * 数字读取按整数兜底，避免坏 JSON 打断整个 worker。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }
}
