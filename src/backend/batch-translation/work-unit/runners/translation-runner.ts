import type { JsonValue } from "../../../../domain/json";
import { read_json_record } from "../../../../domain/json";
import {
  read_text_processing_config,
  type TextProcessingConfig,
  type TextQualitySnapshot,
  type TextTaskItemRecord,
} from "../../../../shared/text/text-processing";
import { read_item_source_text_parts } from "../../../../shared/item-text";
import {
  compile_glossary,
  match_glossary_source,
  type GlossaryEntry,
} from "../../../../shared/quality/glossary";
import { normalize_setting_snapshot } from "../../../../domain/setting";
import { resolve_app_locale } from "../../../../domain/app-language";
import { format_i18n_message, type LocaleKey } from "../../../../shared/i18n";
import {
  TranslationPrePipeline,
  type TranslationPrePipelineContext,
} from "../pipeline/translation-pre-pipeline";
import { TranslationPostPipeline } from "../pipeline/translation-post-pipeline";
import {
  resolve_translation_prompt_mode,
  normalize_translation_actor,
  type TranslationActor,
  type TranslationDecodedItem,
  type TranslationPromptMode,
  type TranslationRequestItem,
} from "../translation-item";
import { PromptBuilder, type PromptBuilderConfig } from "../work-unit-prompt-builder";
import {
  split_translation_response,
  decode_sakura,
  decode_translation,
} from "../response/response-decoder";
import type { LLMRequestResult } from "../../../llm/llm-types";
import type { TranslationRequestPort } from "../../protocol/translation-request";
import type {
  TranslationWorkUnit,
  WorkUnitLogEntry,
  WorkUnitExecutionResult,
} from "../../protocol/work-unit";
import type { LogError } from "../../../../shared/error";

/** 根据公开 work-unit 载荷重建的 worker 本地不可变请求信封。 */
interface TranslationWorkUnitRequest {
  run_id: string; // Isolates one task run across worker messages.
  work_unit_id: string; // Identifies this chunk in logs and diagnostics.
  model: TranslationWorkUnit["model"]; // Frozen model snapshot selected by the BatchTranslationRunner.
  config_snapshot: TranslationWorkUnit["config_snapshot"]; // Frozen processing and locale settings.
  quality_snapshot: TextQualitySnapshot; // Frozen text rules shared by prompt and pipelines.
  items: TextTaskItemRecord[]; // Item snapshots owned by this work unit.
  precedings: TextTaskItemRecord[]; // Context-only items; never written back.
}

/** Runner 结果，尚未包装进跨线程执行信封。 */
interface TranslationWorkUnitResult {
  items: TextTaskItemRecord[];
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  stopped: boolean;
  logs: WorkUnitLogEntry[];
}

/** 以 item 为单位的翻译 worker，逐行准备与恢复由 pipeline 负责。 */
export class TranslationWorkUnitRunner {
  /** 显式持有提示词资源和唯一 LLM 边界，便于 worker 测试。 */
  public constructor(
    private readonly builtin_root: string,
    private readonly llm_client: TranslationRequestPort,
  ) {}

  /** 执行一个翻译单元。提交与重试决策由 BatchTranslationRunner 负责。 */
  public async execute_unit(
    unit: TranslationWorkUnit,
    signal: AbortSignal,
  ): Promise<WorkUnitExecutionResult> {
    const result = await this.execute_items(
      {
        run_id: unit.run_id,
        work_unit_id: unit.unit_id,
        model: unit.model,
        config_snapshot: unit.config_snapshot,
        quality_snapshot: unit.quality_snapshot,
        items: unit.payload.items,
        precedings: unit.payload.precedings,
      },
      signal,
    );
    return {
      unit_id: unit.unit_id,
      kind: "translation",
      outcome: result.stopped
        ? "stopped"
        : result.items.some((item) => item.status === "PROCESSED")
          ? "success"
          : "failed",
      metrics: {
        input_tokens: result.input_tokens,
        reasoning_tokens: result.reasoning_tokens,
        output_tokens: result.output_tokens,
      },
      output: { kind: "translation", items: result.items },
      logs: result.logs,
    };
  }

  /** 准备字段候选，执行协议请求，再校验并恢复完整条目。 */
  private async execute_items(
    request: TranslationWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const config = read_text_processing_config(request.config_snapshot);
    const quality = request.quality_snapshot;
    const items = structuredClone(request.items);
    const precedings = structuredClone(request.precedings);
    const prepared = this.prepare_request_data(request, config, quality, items, precedings);
    if (prepared.done) return prepared.result;
    const is_sakura = String(read_json_record(request.model)["api_format"] ?? "") === "SakuraLLM";
    const result = this.empty_result(items); // 多次请求共用用量与日志，字段写回在执行完成后进行。
    /** 单次请求完成解码、字段校验和日志结算，取消以 null 返回。 */
    const request_once = async (
      request_items: TranslationRequestItem[],
    ): Promise<TranslationDecodedItem[] | null> => {
      if (signal.aborted) return null;
      const mode = resolve_translation_prompt_mode(request_items);
      const prompt = is_sakura
        ? prepared.builder.generate_prompt_sakura(
            request_items.map((item) => item.text_src).join("\n"),
          )
        : prepared.builder.generate_prompt(
            request_items,
            mode,
            prepared.samples,
            prepared.projected_precedings,
          );
      const start_time = Date.now();
      const response = await this.llm_client.request(
        {
          run_id: request.run_id,
          work_unit_id: request.work_unit_id,
          model: request.model,
          config_snapshot: request.config_snapshot,
          messages: prompt.messages,
        },
        signal,
      );
      result.input_tokens += response.input_tokens;
      result.reasoning_tokens += response.reasoning_tokens;
      result.output_tokens += response.output_tokens;
      if (response.cancelled || signal.aborted) return null;
      const request_error = response.request_error ?? response.response_error;
      const failed = request_error !== undefined || response.timeout;
      const parts = failed
        ? { translation_text: "", rule_analysis_text: "" }
        : is_sakura
          ? { translation_text: response.response_result, rule_analysis_text: "" }
          : split_translation_response(response.response_result);
      const decoded = failed
        ? []
        : is_sakura
          ? decode_sakura(parts.translation_text, request_items)
          : await decode_translation(parts.translation_text, mode);
      const valid = this.read_valid_results(request_items, prepared.pipeline_contexts, decoded);
      const by_id = new Map(valid.map((item) => [item.request_id, item]));
      result.logs.push(
        ...this.build_logs(
          {
            request,
            start_time,
            console_log: prompt.console_log,
            request_items,
            mode,
            request_error,
            request_timeout: response.timeout,
          },
          valid.length,
          request_items.map((item) => by_id.get(item.request_id)?.text_dst ?? ""),
          request_items.map((item) => by_id.get(item.request_id)?.actor_dst ?? null),
          response,
          parts,
        ),
      );
      return valid;
    };
    const decoded = is_sakura
      ? await this.execute_sakura_translation(
          prepared.request_items,
          prepared.pipeline_contexts,
          request_once,
        )
      : await request_once(prepared.request_items);
    if (decoded === null || signal.aborted) return { ...result, items: [], stopped: true };
    const by_id = new Map(decoded.map((item) => [item.request_id, item]));
    const post = new TranslationPostPipeline(config, quality);
    for (const request_item of prepared.request_items) {
      const item = items[request_item.item_index]!;
      const decoded_item = by_id.get(request_item.request_id);
      if (decoded_item !== undefined) {
        const output = post.process_item(
          prepared.pipeline_contexts[request_item.item_index]!,
          decoded_item,
        );
        item.dst = output.dst;
        if (Object.hasOwn(output, "name_dst")) item.name_dst = output.name_dst ?? null;
        item.status = "PROCESSED";
      }
    }
    return result;
  }

  /** 为每个 item 构建一条请求记录，并将逐行事实保留在 pipeline 内部。 */
  private prepare_request_data(
    request: TranslationWorkUnitRequest,
    config: TextProcessingConfig,
    quality: TextQualitySnapshot,
    items: TextTaskItemRecord[],
    precedings: TextTaskItemRecord[],
  ):
    | { done: true; result: TranslationWorkUnitResult }
    | {
        done: false;
        request_items: TranslationRequestItem[];
        builder: PromptBuilder;
        samples: string[];
        projected_precedings: TextTaskItemRecord[];
        pipeline_contexts: TranslationPrePipelineContext[];
      } {
    const activated = this.resolve_activated_glossary_entries(quality, items);
    const pipeline = new TranslationPrePipeline(config, quality);
    const projected_precedings = pipeline.project_precedings(precedings);
    const pipeline_contexts: TranslationPrePipelineContext[] = [];
    const request_items: TranslationRequestItem[] = [];
    for (const [item_index, item] of items.entries()) {
      const context = pipeline.process_item(item, item_index, request_items.length);
      pipeline_contexts.push(context);
      if (context.request_item !== null) request_items.push(context.request_item);
      else {
        item.dst = String(item.src ?? "");
        item.status = "PROCESSED";
      }
    }
    if (request_items.length === 0)
      return {
        done: true,
        result: this.empty_result(items),
      };
    const samples = pipeline_contexts.flatMap((context) => context.samples);
    const builder = new PromptBuilder(
      this.builtin_root,
      this.config_to_prompt_config(config, request.config_snapshot),
      quality,
      activated,
    );
    return {
      done: false,
      request_items,
      builder,
      samples,
      projected_precedings,
      pipeline_contexts,
    };
  }

  /** 正文合批，姓名独立请求。null 表示取消，字段结果只在条目完整时提交。 */
  private async execute_sakura_translation(
    items: readonly TranslationRequestItem[],
    contexts: readonly TranslationPrePipelineContext[],
    request: (items: TranslationRequestItem[]) => Promise<TranslationDecodedItem[] | null>,
  ): Promise<TranslationDecodedItem[] | null> {
    const body_items = items.filter((item) =>
      contexts[item.item_index]!.prepared_lines.some((line) => line.state === "translatable"),
    );
    const bodies =
      body_items.length === 0
        ? []
        : await request(body_items.map((item) => ({ ...item, actor_src: null })));
    if (bodies === null) return null;
    const by_id = new Map(bodies.map((item) => [item.request_id, item])); // 只包含已通过正文校验的结果。
    const names = new Map<string, string | null>(); // 当前批次相同请求输入复用结果，包括失败。
    const result: TranslationDecodedItem[] = [];
    for (const item of items) {
      const body_required = contexts[item.item_index]!.prepared_lines.some(
        (line) => line.state === "translatable",
      );
      const body = by_id.get(item.request_id);
      if (body_required && body === undefined) continue;
      let actor_dst: string | null = null;
      if (item.actor_src !== null) {
        if (!names.has(item.actor_src)) {
          const name = await request([{ ...item, text_src: item.actor_src, actor_src: null }]);
          if (name === null) return null;
          names.set(item.actor_src, normalize_translation_actor(name[0]?.text_dst));
        }
        actor_dst = names.get(item.actor_src) ?? null;
      }
      // 姓名是本次条目的必需字段，失败时交回现有条目重试。
      if (item.actor_src !== null && actor_dst === null) continue;
      result.push({ request_id: item.request_id, text_dst: body?.text_dst ?? "", actor_dst });
    }
    return result;
  }

  /** 字段候选决定完成条件，重复 ID 或缺失必需字段只影响对应条目。 */
  private read_valid_results(
    request_items: readonly TranslationRequestItem[],
    contexts: readonly TranslationPrePipelineContext[],
    decoded: readonly TranslationDecodedItem[],
  ): TranslationDecodedItem[] {
    const by_id = new Map<number, TranslationDecodedItem>();
    const duplicates = new Set<number>(); // 同一请求 ID 出现多个候选时，无法唯一对应译文。
    for (const item of decoded) {
      if (by_id.has(item.request_id)) duplicates.add(item.request_id);
      else by_id.set(item.request_id, item);
    }
    return request_items.flatMap((request_item) => {
      const item = by_id.get(request_item.request_id);
      if (item === undefined || duplicates.has(request_item.request_id)) return [];
      const body_required = contexts[request_item.item_index]!.prepared_lines.some(
        (line) => line.state === "translatable",
      );
      return (body_required && item.text_dst.trim() === "") ||
        (request_item.actor_src !== null && item.actor_dst === null)
        ? []
        : [item];
    });
  }

  /** 生成结构化 worker 日志，不暴露内部对齐细节。 */
  private build_logs(
    context: {
      request: TranslationWorkUnitRequest;
      start_time: number;
      console_log: string[];
      request_items: TranslationRequestItem[];
      mode: TranslationPromptMode;
      request_error?: LogError | undefined;
      request_timeout: boolean;
    },
    valid_count: number,
    dsts: string[],
    actor_dsts: TranslationActor[],
    response: LLMRequestResult,
    response_parts: { translation_text: string; rule_analysis_text: string },
  ): WorkUnitLogEntry[] {
    const app_language = normalize_setting_snapshot(context.request.config_snapshot).app_language;
    const ended_at = Date.now();
    const stats = this.t(app_language, "app.log.engine_task_success", {
      CT: String(response.output_tokens),
      LINES: String(context.request_items.length),
      PT: String(response.input_tokens),
      RT: String(response.reasoning_tokens),
      TIME: ((ended_at - context.start_time) / 1000).toFixed(2),
    });
    const summary = [stats];
    let level: WorkUnitLogEntry["level"] = "info";
    // 供应商异常和本地超时共用请求失败摘要，结构化 error 仍只承载真实供应商诊断。
    const request_failure_text =
      context.request_error?.message ??
      (context.request_timeout ? this.t(app_language, "app.log.request_timeout") : null);
    if (request_failure_text !== null) {
      level = "error";
      summary.push(
        this.t(app_language, "app.log.request_failed", {
          ERROR: request_failure_text,
        }),
      );
    } else if (valid_count === 0) {
      level = "error";
      summary.push(this.t(app_language, "app.log.model_response_invalid"));
    } else if (valid_count < context.request_items.length) {
      level = "warning";
      summary.push(this.t(app_language, "app.log.translation_response_partially_invalid"));
    }
    summary.push(...context.console_log.map((text) => text.trim()).filter(Boolean));
    const sections: Array<{ title: string; text: string }> = [];
    if (response.response_think.trim() !== "") {
      sections.push({
        title: this.t(app_language, "app.log.engine_task_thinking_process"),
        text: response.response_think.trim(),
      });
    }
    if (response_parts.rule_analysis_text.trim() !== "") {
      sections.push({
        title: this.t(app_language, "app.log.engine_task_rule_analysis"),
        text: response_parts.rule_analysis_text.trim(),
      });
    }
    if (response_parts.translation_text.trim() !== "") {
      sections.push({
        title: this.t(app_language, "app.log.translation_task_result"),
        text: response_parts.translation_text.trim(),
      });
    }
    return [
      {
        level,
        content: {
          kind: "translation_result",
          started_at: new Date(context.start_time).toISOString(),
          ended_at: new Date(ended_at).toISOString(),
          summary,
          sections,
          pairs: context.request_items.map((item, index) => ({
            src: item.text_src,
            dst: dsts[index] ?? "",
            ...(context.mode === "actor_text"
              ? { actor_src: item.actor_src, actor_dst: actor_dsts[index] ?? null }
              : {}),
          })),
        },
        ...(context.request_error ? { error: context.request_error } : {}),
      },
    ];
  }

  /** 根据原始 item 字段激活术语，匹配依据与项目规则保持一致。 */
  private resolve_activated_glossary_entries(
    quality: TextQualitySnapshot,
    items: TextTaskItemRecord[],
  ): GlossaryEntry[] {
    if (!quality.glossary_enable) return [];
    const compiled = compile_glossary(
      quality.glossary_entries.map((entry): GlossaryEntry => ({
        entry_id: String(entry["entry_id"]),
        src: String(entry["src"] ?? ""),
        dst: String(entry["dst"] ?? ""),
        info: String(entry["info"] ?? ""),
        case_sensitive: entry["case_sensitive"] === true,
      })),
    );
    const ids = new Set(
      items.flatMap((item) =>
        match_glossary_source(compiled, read_item_source_text_parts(item)).map(
          ({ entry }) => entry.entry_id,
        ),
      ),
    );
    return compiled.entries.filter((entry) => entry.dst.trim() !== "" && ids.has(entry.entry_id));
  }

  /** 将运行快照投影为 PromptBuilder 所需的窄配置契约。 */
  private config_to_prompt_config(
    config: TextProcessingConfig,
    raw: JsonValue,
  ): PromptBuilderConfig {
    const settings = normalize_setting_snapshot(raw);
    return {
      app_language: settings.app_language,
      source_language: config.source_language,
      target_language: config.target_language,
      prompt_enhancement_enable: settings.prompt_enhancement_enable,
    };
  }

  /** 创建请求执行前的空结果，用量随每次响应累加。 */
  private empty_result(items: TextTaskItemRecord[]): TranslationWorkUnitResult {
    return {
      items,
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      stopped: false,
      logs: [],
    };
  }
  /** 使用任务启动时的语言快照本地化 worker 诊断信息。 */
  private t(app_language: unknown, key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_app_locale(app_language), key, params);
  }
}
