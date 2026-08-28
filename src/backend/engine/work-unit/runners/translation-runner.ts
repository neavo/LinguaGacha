import type { JsonValue } from "../../../../domain/json";
import { is_json_record, read_json_integer, read_json_record } from "../../../../domain/json";
import {
  TextProcessingConfigTool,
  TextQualitySnapshotTool,
  type TextProcessingConfig,
  type TextQualitySnapshot,
  type TextTaskItemRecord,
} from "../../../../shared/text/text-types";
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
  type TranslationActor,
  type TranslationDecodedItem,
  type TranslationPromptMode,
  type TranslationRequestItem,
} from "../translation-item";
import { PromptBuilder, type PromptBuilderConfig } from "../work-unit-prompt-builder";
import { ResponseChecker } from "../response/response-checker";
import { ResponseCleaner } from "../response/response-cleaner";
import { ResponseDecoder } from "../response/response-decoder";
import type { LLMClientPort, LLMMessage, LLMRequestResult } from "../../../llm/llm-types";
import type { TranslationWorkUnit, WorkUnitLogEntry } from "../../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../../protocol/work-unit-result";
import type { LogError } from "../../../../shared/error";

/** Worker-local immutable request envelope reconstructed from the public unit payload. */
interface TranslationWorkUnitRequest {
  run_id: string; // Isolates one task run across worker messages.
  work_unit_id: string; // Identifies this chunk in logs and diagnostics.
  model: JsonValue; // Frozen model snapshot selected by the Engine.
  config_snapshot: JsonValue; // Frozen processing and locale settings.
  quality_snapshot: JsonValue; // Frozen text rules shared by prompt and pipelines.
  items: JsonValue; // Item snapshots owned by this work unit.
  precedings?: JsonValue; // Context-only items; never written back.
  split_count?: JsonValue; // Diagnostic retry context retained by the Engine.
  retry_count?: JsonValue; // Diagnostic retry context retained by the Engine.
  token_threshold?: JsonValue; // Planner threshold used for this chunk.
  is_initial?: JsonValue; // Distinguishes first execution from retries.
}

/** Runner result before it is wrapped in the cross-thread execution envelope. */
interface TranslationWorkUnitResult {
  items: TextTaskItemRecord[];
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  stopped: boolean;
  logs?: WorkUnitLogEntry[];
}

/** Item-oriented translation worker. Line preparation/restoration stays inside the pipelines. */
export class TranslationWorkUnitRunner {
  /** Keeps prompt resources and the sole LLM boundary explicit for worker tests. */
  public constructor(
    private readonly app_root: string,
    private readonly llm_client: LLMClientPort,
  ) {}

  /** Executes one translation unit; Engine owns commit and retry decisions. */
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
      output: { kind: "translation", items: result.items as unknown as JsonValue },
      logs: result.logs ?? [],
    };
  }

  /** Runs preparation, one LLM request, decoding, checking and item restoration. */
  private async execute_items(
    request: TranslationWorkUnitRequest,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    const config = TextProcessingConfigTool.from_api_value(request.config_snapshot);
    const quality = TextQualitySnapshotTool.from_api_value(request.quality_snapshot);
    const items = this.read_item_list(request.items);
    const precedings = this.read_item_list(request.precedings);
    const prepared = await this.prepare_request_data(request, config, quality, items, precedings);
    if (prepared.done) return prepared.result;
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
    if (response.cancelled || signal.aborted) return { ...this.empty_result(), stopped: true };
    return this.apply_response_data(
      {
        ...prepared,
        config,
        quality,
        request,
        start_time,
        items,
        stream_degraded: response.degraded,
        request_error: response.request_error,
        request_timeout: response.timeout,
      },
      response,
    );
  }

  /** Builds one request record per item while retaining line facts inside the pipeline. */
  private async prepare_request_data(
    request: TranslationWorkUnitRequest,
    config: TextProcessingConfig,
    quality: TextQualitySnapshot,
    items: TextTaskItemRecord[],
    precedings: TextTaskItemRecord[],
  ): Promise<
    | { done: true; result: TranslationWorkUnitResult }
    | {
        done: false;
        request_items: TranslationRequestItem[];
        mode: TranslationPromptMode;
        messages: LLMMessage[];
        console_log: string[];
        pipeline_contexts: TranslationPrePipelineContext[];
      }
  > {
    const activated = this.resolve_activated_glossary_entries(quality, items);
    const pipeline = new TranslationPrePipeline(config, quality);
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
        result: { items, input_tokens: 0, reasoning_tokens: 0, output_tokens: 0, stopped: false },
      };
    const samples = pipeline_contexts.flatMap((context) => context.samples);
    const builder = new PromptBuilder(
      this.app_root,
      this.config_to_prompt_config(config, request.config_snapshot),
      quality,
      activated,
    );
    const api_format = String(read_json_record(request.model)["api_format"] ?? "OpenAI");
    const mode =
      api_format === "SakuraLLM" ? "text" : resolve_translation_prompt_mode(request_items);
    const prompt =
      api_format === "SakuraLLM"
        ? builder.generate_prompt_sakura(request_items.map((item) => item.text_src))
        : await builder.generate_prompt(request_items, mode, samples, precedings);
    return {
      done: false,
      request_items,
      mode,
      messages: prompt.messages,
      console_log: prompt.console_log,
      pipeline_contexts,
    };
  }

  /** Applies independent index checks so one malformed item cannot poison its siblings. */
  private async apply_response_data(
    context: {
      config: TextProcessingConfig;
      quality: TextQualitySnapshot;
      request: TranslationWorkUnitRequest;
      start_time: number;
      console_log: string[];
      request_items: TranslationRequestItem[];
      mode: TranslationPromptMode;
      pipeline_contexts: TranslationPrePipelineContext[];
      items: TextTaskItemRecord[];
      stream_degraded: boolean;
      request_error?: LogError;
      request_timeout: boolean;
    },
    response: LLMRequestResult,
  ): Promise<TranslationWorkUnitResult> {
    const cleaner =
      context.request_error === undefined
        ? ResponseCleaner.extract_rule_analysis_from_response(response.response_result)
        : { cleaned_response_result: "", rule_analysis_text: "" };
    const decoded =
      context.request_error === undefined
        ? await new ResponseDecoder().decode_translation(
            cleaner.cleaned_response_result,
            context.mode,
          )
        : [];
    const by_index = new Map<number, TranslationDecodedItem>();
    const duplicates = new Set<number>();
    for (const item of decoded) {
      if (by_index.has(item.request_index)) duplicates.add(item.request_index);
      else by_index.set(item.request_index, item);
    }
    const checks: string[] = [];
    const dsts: string[] = [];
    const actor_dsts: TranslationActor[] = [];
    const post = new TranslationPostPipeline(context.config, context.quality);
    for (const request_item of context.request_items) {
      const item = context.items[request_item.item_index];
      const pipeline_context = context.pipeline_contexts[request_item.item_index];
      const decoded_item = by_index.get(request_item.request_index);
      const check =
        context.request_error !== undefined
          ? "FAIL_REQUEST"
          : context.request_timeout
            ? "FAIL_TIMEOUT"
            : context.stream_degraded
              ? "FAIL_DEGRADATION"
              : decoded_item === undefined || duplicates.has(request_item.request_index)
                ? "FAIL_DATA"
                : ResponseChecker.check_item(
                    request_item.text_src,
                    decoded_item.text_dst,
                    context.config.source_language,
                    item?.skip_internal_filter === true,
                  );
      checks.push(check);
      // Keep log pairs positional even when a response item is missing or malformed.
      dsts.push(decoded_item?.text_dst ?? "");
      actor_dsts.push(decoded_item?.actor_dst ?? null);
      if (check === "NONE" && decoded_item && item && pipeline_context) {
        const result = post.process_item(pipeline_context, decoded_item, context.mode);
        item.dst = result.dst;
        if (Object.hasOwn(result, "name_dst")) item.name_dst = result.name_dst ?? null;
        item.status = "PROCESSED";
      } else if (check !== "NONE" && item && context.request_items.length === 1)
        item.retry_count = read_json_integer(item.retry_count, 0) + 1;
    }
    return {
      items: context.items,
      input_tokens: response.input_tokens,
      reasoning_tokens: response.reasoning_tokens,
      output_tokens: response.output_tokens,
      stopped: false,
      logs: this.build_logs(context, checks, dsts, actor_dsts, response, cleaner),
    };
  }

  /** Produces the structured worker log without exposing internal alignment details. */
  private build_logs(
    context: {
      request: TranslationWorkUnitRequest;
      start_time: number;
      console_log: string[];
      request_items: TranslationRequestItem[];
      mode: TranslationPromptMode;
      request_error?: LogError;
    },
    checks: string[],
    dsts: string[],
    actor_dsts: TranslationActor[],
    response: LLMRequestResult,
    cleaner: { cleaned_response_result: string; rule_analysis_text: string },
  ): WorkUnitLogEntry[] {
    const app_language = normalize_setting_snapshot(context.request.config_snapshot).app_language;
    const stats = this.t(app_language, "app.log.engine_task_success", {
      CT: String(response.output_tokens),
      LINES: String(context.request_items.length),
      PT: String(response.input_tokens),
      RT: String(response.reasoning_tokens),
      TIME: ((Date.now() - context.start_time) / 1000).toFixed(2),
    });
    const errors = checks.filter((check) => check !== "NONE").join("、");
    const summary = errors === "" ? [stats] : [stats, errors];
    summary.push(...context.console_log.map((text) => text.trim()).filter(Boolean));
    const sections: Array<{ title: string; text: string }> = [];
    if (response.response_think.trim() !== "") {
      sections.push({
        title: this.t(app_language, "app.log.engine_task_thinking_process"),
        text: response.response_think.trim(),
      });
    }
    if (cleaner.rule_analysis_text.trim() !== "") {
      sections.push({
        title: this.t(app_language, "app.log.engine_task_rule_analysis"),
        text: cleaner.rule_analysis_text.trim(),
      });
    }
    if (cleaner.cleaned_response_result.trim() !== "") {
      sections.push({
        title: this.t(app_language, "app.log.translation_task_result"),
        text: cleaner.cleaned_response_result.trim(),
      });
    }
    return [
      {
        level: context.request_error ? "error" : errors === "" ? "info" : "warning",
        content: {
          kind: "translation_result",
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

  /** Activates glossary entries from original item fields, not transformed prompt text. */
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

  /** Projects run snapshots to the prompt builder's narrow configuration contract. */
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
  /** Narrows cross-thread JSON arrays to independent mutable item snapshots. */
  private read_item_list(value: JsonValue | undefined): TextTaskItemRecord[] {
    return Array.isArray(value) ? value.filter(is_json_record).map((item) => ({ ...item })) : [];
  }
  /** Returns the neutral result used for cancellation and empty request branches. */
  private empty_result(): TranslationWorkUnitResult {
    return { items: [], input_tokens: 0, reasoning_tokens: 0, output_tokens: 0, stopped: false };
  }
  /** Localizes worker diagnostics using the task-start language snapshot. */
  private t(app_language: unknown, key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_app_locale(app_language), key, params);
  }
}
