import crypto from "node:crypto";
import path from "node:path";

import type { LogManager } from "../log/log-manager";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { LLMClient } from "../llm/llm-client";
import { list_available_models } from "../llm/llm-model-catalog";
import type { LLMMessage, LLMRequestResult } from "../llm/llm-types";
import { collect_api_keys } from "../llm/llm-client-policy";
import {
  MODEL_USAGES,
  Model,
  is_model_thinking_level,
  normalize_model_selection,
  parse_model_agent_config,
  type CustomModelType,
  type ModelSelection,
  type ModelUsage,
} from "../../domain/model";
import {
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import { normalize_setting_snapshot } from "../../domain/setting";
import {
  read_config_model_preset_records,
  read_config_model_records,
} from "./model-config-resolver";
import { resolve_app_locale } from "../../domain/app-language";
import { format_i18n_message, type LocaleKey } from "../../shared/i18n";
import { JsonTool } from "../../shared/utils/json-tool";
import * as AppErrors from "../../shared/error";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { RuntimeOperationGate } from "../runtime-operation-gate";

// 模型页只允许写入这些配置字段，防止表单 patch 污染持久化模型对象
const PATCH_ALLOWED_KEYS = new Set([
  "name",
  "api_url",
  "api_key",
  "model_id",
  "agent",
  "thinking",
  "threshold",
  "generation",
  "request",
]);

type ModelTestFailure = {
  reason: string;
  error?: AppErrors.LogError;
};

// 嵌套配置字段采用浅合并，保留未出现在 patch 中的历史配置项
const PATCH_OBJECT_KEYS = new Set(["agent", "thinking", "threshold", "generation", "request"]);
// Agent 容量是原子数值对，不接受领域协议外的嵌套字段。
const MODEL_AGENT_PATCH_KEYS = new Set(["context_window", "max_output_tokens"]);

/**
 * 封装模型配置 CRUD 与按用途选择；任务执行时由调用方解析不可变模型快照
 */
export class ModelService {
  private readonly paths: AppPathService; // 提供模型内置预设目录
  private readonly app_setting_service: AppSettingService; // 模型配置唯一持久化入口
  private readonly llm_user_agent: string; // 来自 AppMetadataService，模型测试不再读取 version.txt
  private readonly runtime_gate: RuntimeOperationGate; // 模型配置写入只允许在统一运行态空闲时发生
  private readonly log_manager?: Pick<LogManager, "info" | "warning">; // 只记录模型探测诊断
  private readonly native_fs: NativeFs; // 统一读取内置模型预设文件

  /**
   * 初始化 ModelService 依赖，保持外部写入口清晰
   */
  public constructor(
    paths: AppPathService,
    app_setting_service: AppSettingService,
    llm_user_agent: string,
    runtime_gate: RuntimeOperationGate,
    log_manager?: Pick<LogManager, "info" | "warning">,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.paths = paths;
    this.app_setting_service = app_setting_service;
    this.llm_user_agent = llm_user_agent;
    this.runtime_gate = runtime_gate;
    this.log_manager = log_manager;
    this.native_fs = native_fs;
  }

  /**
   * 读取模型页完整快照，供 UI 一次性恢复配置状态
   */
  public get_snapshot(): JsonRecord {
    const config = this.load_setting_with_models(true);
    return this.build_snapshot_response(config);
  }

  /** 读取任务入口直接控制所需的非敏感模型摘要。 */
  public get_selection_snapshot(): JsonRecord {
    return this.build_selection_snapshot(this.load_setting_with_models(true));
  }

  /**
   * 更新模型白名单字段，避免页面写入未知配置
   */
  public update_model(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const model_id = String(request["model_id"] ?? "");
    const patch_value = request["patch"];
    if (typeof patch_value !== "object" || patch_value === null || Array.isArray(patch_value)) {
      throw new AppErrors.RequestValidationError();
    }
    const patch = patch_value as JsonRecord;
    for (const key of Object.keys(patch)) {
      if (!PATCH_ALLOWED_KEYS.has(key)) {
        throw new AppErrors.RequestValidationError({
          public_details: { field: key },
        });
      }
    }
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    models[index] = this.apply_patch(models[index] ?? {}, patch);
    config["models"] = models as unknown as JsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 只更新一个任务用途的模型选择，另外两个用途保持不变
   */
  public select_model(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const usage = this.read_model_usage(request["usage"]);
    const model_id = typeof request["model_id"] === "string" ? request["model_id"].trim() : "";
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    this.find_model_index_or_raise(models, model_id);
    const selection = normalize_model_selection(config["model_selection"]);
    selection[usage] = model_id;
    config["model_selection"] = selection;
    return this.build_selection_snapshot(this.persist_config(config));
  }

  /** 按用途原子更新当前模型的全局思考档位，避免调用方提交过期模型 ID。 */
  public update_selected_model_thinking_level(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const usage = this.read_model_usage(request["usage"]);
    const thinking_level = request["thinking_level"];
    if (!is_model_thinking_level(thinking_level)) {
      throw new AppErrors.RequestValidationError({
        public_details: { field: "thinking_level" },
      });
    }
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    const selection = normalize_model_selection(config["model_selection"]);
    const index = this.find_model_index_or_raise(models, selection[usage]);
    const model = models[index] ?? {};
    if (
      !Model.api_format_supports_thinking_configuration(
        Model.normalize_api_format(model["api_format"]),
      )
    ) {
      throw new AppErrors.RequestValidationError({
        public_details: { field: "thinking_level" },
      });
    }
    models[index] = this.apply_patch(model, { thinking: { level: thinking_level } });
    config["models"] = models as unknown as JsonValue;
    return this.build_selection_snapshot(this.persist_config(config));
  }

  /**
   * 新增自定义模型，避免调用方复制默认字段补齐规则
   */
  public add_model(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const model_type = String(request["model_type"] ?? "");
    if (!Model.is_custom_type(model_type)) {
      throw new AppErrors.RequestValidationError({
        public_details: { model_type },
      });
    }
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    models.push(this.build_custom_model(model_type));
    config["models"] = models as unknown as JsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 删除模型并为所有引用该模型的用途重选，防止配置留下悬空引用
   */
  public delete_model(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    const target_model = models[index] ?? {};
    if (String(target_model["type"] ?? "PRESET") === "PRESET") {
      throw new AppErrors.RequestValidationError();
    }
    models.splice(index, 1);
    const selection = normalize_model_selection(config["model_selection"]);
    const fallback = this.pick_selection_fallback(models, String(target_model["type"] ?? ""));
    for (const usage of MODEL_USAGES) {
      if (selection[usage] === model_id) {
        selection[usage] = String(fallback?.["id"] ?? "");
      }
    }
    config["model_selection"] = selection;
    config["models"] = models as unknown as JsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 用内置预设重置模型，保持 preset 事实来自资源目录
   */
  public reset_preset_model(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    if (String(models[index]?.["type"] ?? "") !== "PRESET") {
      throw new AppErrors.RequestValidationError();
    }
    const preset = this.load_preset_models().find((item) => String(item["id"] ?? "") === model_id);
    if (preset === undefined) {
      throw new AppErrors.ModelNotFoundError();
    }
    models[index] = this.normalize_model(preset);
    config["models"] = models as unknown as JsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 重排同组模型，确保 ordered ids 完整覆盖当前分组
   */
  public reorder_model(request: JsonRecord): JsonRecord {
    this.runtime_gate.assert_runtime_idle();
    const ordered_ids_raw = request["ordered_model_ids"];
    if (!Array.isArray(ordered_ids_raw)) {
      throw new AppErrors.RequestValidationError();
    }
    const ordered_ids = ordered_ids_raw.map((value) => String(value).trim()).filter(Boolean);
    if (ordered_ids.length === 0) {
      throw new AppErrors.RequestValidationError();
    }
    const config = this.load_setting_with_models(false);
    const models = read_config_model_records(config);
    const first_index = this.find_model_index_or_raise(models, ordered_ids[0] ?? "");
    const model_type = String(models[first_index]?.["type"] ?? "PRESET");
    const expected_ids = models
      .filter((model) => String(model["type"] ?? "PRESET") === model_type)
      .map((model) => String(model["id"] ?? ""))
      .filter(Boolean);
    const ordered_id_set = new Set(ordered_ids);
    if (
      expected_ids.length !== ordered_ids.length ||
      expected_ids.some((model_id) => !ordered_id_set.has(model_id))
    ) {
      throw new AppErrors.RequestValidationError();
    }
    const reordered = this.reorder_group(models, model_type, ordered_ids);
    config["models"] = reordered as unknown as JsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 查询远端实时模型列表；任务级 Key 轮换不参与模型列表探测。
   */
  public async list_available_models(request: JsonRecord): Promise<JsonRecord> {
    const config = this.load_setting_with_models(false);
    const model = this.get_model_from_request(config, request);
    const models = await list_available_models(model);
    return { models: models as unknown as JsonValue };
  }

  /**
   * 模型连通性测试复用同一 LLM request client，确保模型页和任务请求走同一策略。
   */
  public async test_model(request: JsonRecord): Promise<JsonRecord> {
    const config = this.load_setting_with_models(false);
    const model = this.get_model_from_request(config, request);
    const keys = collect_api_keys(String(model["api_key"] ?? ""));
    const client = new LLMClient({ userAgent: this.llm_user_agent });
    const key_results: Array<JsonRecord> = [];
    const app_language = config["app_language"];
    const messages = this.build_model_test_messages(String(model["api_format"] ?? "OpenAI"));
    for (const api_key of keys) {
      const model_for_test = { ...model, api_key };
      const masked_key = this.mask_api_key(api_key);
      this.log_model_test_key_start(app_language, masked_key, messages);
      const started_at = Date.now();
      const result = await client.request(
        {
          run_id: crypto.randomUUID(),
          work_unit_id: "model-test",
          model: model_for_test as unknown as JsonValue,
          config_snapshot: config as unknown as JsonValue,
          messages,
        },
        new AbortController().signal,
      );
      const response_time_ms = Math.max(0, Date.now() - started_at);
      const failure = this.build_model_test_failure(result, config);
      if (failure === null) {
        this.log_model_test_success(app_language, result, response_time_ms);
      } else {
        this.log_model_test_failure(app_language, failure);
      }
      key_results.push({
        masked_key,
        success: failure === null,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        response_time_ms,
        error_reason: failure?.reason ?? "",
      });
    }
    const success_count = key_results.filter((item) => item["success"] === true).length;
    const failure_count = key_results.length - success_count;
    const result_msg = this.t(app_language, "app.log.api_test_result", {
      COUNT: key_results.length.toString(),
      FAILURE: failure_count.toString(),
      SUCCESS: success_count.toString(),
    });
    this.log_model_test_summary(app_language, result_msg, key_results);
    return {
      success: failure_count === 0,
      result_msg,
      total_count: key_results.length,
      success_count,
      failure_count,
      total_response_time_ms: key_results.reduce(
        (sum, item) => sum + this.read_response_time_ms(item["response_time_ms"]),
        0,
      ),
      key_results: key_results as unknown as JsonValue,
    };
  }

  /**
   * 请求中的 model_id 只作为配置索引，不直接信任页面传入完整模型
   */
  private get_model_from_request(config: JsonRecord, request: JsonRecord): JsonRecord {
    const model_id = String(request["model_id"] ?? "");
    const models = read_config_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    return models[index] ?? {};
  }

  /**
   * 模型测试提示词保持旧入口语义，Sakura 继续走纯文本翻译请求
   */
  private build_model_test_messages(api_format: string): LLMMessage[] {
    if (api_format === "SakuraLLM") {
      return [
        {
          role: "system",
          content:
            "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
        },
        {
          role: "user",
          content: "将下面的日文文本翻译成中文：魔導具師ダリヤはうつむかない",
        },
      ];
    }
    return [
      {
        role: "system",
        content: "任务目标是将内容文本翻译成中文，译文必须严格保持原文的格式。",
      },
      {
        role: "user",
        content: '{"0":"魔導具師ダリヤはうつむかない"}',
      },
    ];
  }

  /**
   * 将模型测试请求事实转成单个密钥的失败摘要和结构化诊断。
   */
  private build_model_test_failure(
    result: LLMRequestResult,
    config: JsonRecord,
  ): ModelTestFailure | null {
    if (result.cancelled) {
      return { reason: "请求已取消。" };
    }
    if (result.timeout) {
      return {
        reason: this.t(config["app_language"], "app.log.api_test_timeout", {
          SECONDS: String(normalize_setting_snapshot(config).request_timeout),
        }),
      };
    }
    if (result.degraded) {
      return {
        reason: this.t(config["app_language"], "app.log.response_checker_fail_degradation"),
      };
    }
    if (result.request_error !== undefined) {
      return { reason: result.request_error.message, error: result.request_error };
    }
    return null;
  }

  /**
   * 每个密钥单独记录脱敏 key 与实际请求消息，便于对应探测结果。
   */
  private log_model_test_key_start(
    app_language: unknown,
    masked_key: string,
    messages: LLMMessage[],
  ): void {
    this.log_manager?.info("", { source: "model" });
    this.log_manager?.info(`${this.t(app_language, "app.log.api_test_key")}\n${masked_key}`, {
      source: "model",
    });
    this.log_manager?.info(
      `${this.t(app_language, "app.log.api_test_messages")}\n${this.format_model_test_messages_for_log(messages)}`,
      { source: "model" },
    );
  }

  /**
   * 成功日志按 thinking 和 answer 分段，并统一记录 token 与耗时。
   */
  private log_model_test_success(
    app_language: unknown,
    result: LLMRequestResult,
    response_time_ms: number,
  ): void {
    if (result.response_think === "") {
      this.log_manager?.info(
        `${this.t(app_language, "app.log.api_test_response_result")}\n${result.response_result}`,
        { source: "model" },
      );
    } else {
      this.log_manager?.info(
        `${this.t(app_language, "app.log.engine_task_thinking_process")}\n${result.response_think}`,
        { source: "model" },
      );
      this.log_manager?.info(
        `${this.t(app_language, "app.log.api_test_response_result")}\n${result.response_result}`,
        { source: "model" },
      );
    }
    this.log_manager?.info(
      this.t(app_language, "app.log.api_test_token_info", {
        CT: result.output_tokens.toString(),
        PT: result.input_tokens.toString(),
        TIME: (response_time_ms / 1000).toFixed(2),
      }),
      { source: "model" },
    );
  }

  /**
   * 模型测试失败日志只把稳定摘要放进 message，具体原因进入结构化错误字段。
   */
  private log_model_test_failure(app_language: unknown, failure: ModelTestFailure): void {
    const error = failure.error ?? AppErrors.log_error_from_message(failure.reason);
    this.log_manager?.warning(this.t(app_language, "app.log.api_test_fail"), {
      source: "model",
      error,
    });
  }

  /**
   * 汇总全部密钥结果；失败列表只输出脱敏 key。
   */
  private log_model_test_summary(
    app_language: unknown,
    result_msg: string,
    key_results: Array<JsonRecord>,
  ): void {
    this.log_manager?.info("", { source: "model" });
    this.log_manager?.info(result_msg, { source: "model" });
    const failed_keys = key_results
      .filter((item) => item["success"] !== true)
      .map((item) => String(item["masked_key"] ?? ""))
      .filter(Boolean);
    if (failed_keys.length > 0) {
      this.log_manager?.warning(
        `${this.t(app_language, "app.log.api_test_result_failure")}\n${failed_keys.join("\n")}`,
        { source: "model" },
      );
    }
  }

  /**
   * 沿用既有 Python repr 日志形状，方便用户复核实际 messages。
   */
  private format_model_test_messages_for_log(messages: LLMMessage[]): string {
    const rows = messages.map(
      (message) =>
        `{'role': '${this.escape_python_repr(message.role)}', 'content': '${this.escape_python_repr(
          message.content,
        )}'}`,
    );
    return `[${rows.join(", ")}]`;
  }

  /**
   * 只转义反斜杠和单引号，配合上方 repr 形状。
   */
  private escape_python_repr(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  }

  /**
   * 模型探测日志按当前应用语言解析，后台不固定语言。
   */
  private t(app_language: unknown, key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_app_locale(app_language), key, params);
  }

  /**
   * API Key 日志与响应只展示脱敏结果，避免页面 toast 泄露密钥
   */
  private mask_api_key(key: string): string {
    const normalized_key = key.trim();
    if (normalized_key === "") {
      return "";
    }
    if (normalized_key.length <= 8) {
      return "*".repeat(Math.max(4, normalized_key.length));
    }
    if (normalized_key.length <= 16) {
      return `${normalized_key.slice(0, 2)}${"*".repeat(normalized_key.length - 4)}${normalized_key.slice(-2)}`;
    }
    return `${normalized_key.slice(0, 8)}${"*".repeat(normalized_key.length - 16)}${normalized_key.slice(-8)}`;
  }

  /**
   * 测试耗时来自本地计时，仍在边界处收窄一次以防响应结构被误改
   */
  private read_response_time_ms(value: JsonValue | undefined): number {
    const number_value = Number(value ?? 0);
    return Number.isFinite(number_value) ? Math.max(0, Math.trunc(number_value)) : 0;
  }

  /**
   * 保存配置后立即重建快照，保证响应反映持久化结果
   */
  private persist_config_and_build_snapshot(config: MutableJsonRecord): JsonRecord {
    return this.build_snapshot_response(this.persist_config(config));
  }

  /** 保存前统一排序模型并修复悬空选择，所有配置写入共享这一出口。 */
  private persist_config(config: MutableJsonRecord): MutableJsonRecord {
    const models = this.sort_models(read_config_model_records(config));
    config["models"] = models as unknown as JsonValue;
    config["model_selection"] = this.normalize_selection_for_models(config, models);
    this.app_setting_service.save_setting(config);
    return config;
  }

  /**
   * 读取配置后统一完成模型初始化、排序和三用途选择归一
   */
  private load_setting_with_models(persist_defaults: boolean): MutableJsonRecord {
    const config = this.app_setting_service.read_setting();
    const models = this.sort_models(this.initialize_models(read_config_model_records(config)));
    config["models"] = models as unknown as JsonValue;
    config["model_selection"] = this.normalize_selection_for_models(config, models);
    if (persist_defaults) {
      this.app_setting_service.save_setting(config);
    }
    return config;
  }

  /**
   * 初始化模型集合，合并用户配置和内置预设
   */
  private initialize_models(existing_models: JsonRecord[]): JsonRecord[] {
    const models = existing_models.map((model) => this.normalize_model(model));
    const existing_ids = new Set(models.map((model) => String(model["id"] ?? "")));
    for (const preset of this.load_preset_models()) {
      if (!existing_ids.has(String(preset["id"] ?? ""))) {
        models.push(this.normalize_model(preset));
      }
    }
    for (const model_type of Model.custom_types()) {
      if (!models.some((model) => String(model["type"] ?? "") === model_type)) {
        models.push(this.build_custom_model(model_type));
      }
    }
    return models;
  }

  /**
   * 读取内置模型预设，保持 UI 语言不影响模型集合
   */
  private load_preset_models(): JsonRecord[] {
    return read_config_model_preset_records(this.paths, this.native_fs);
  }

  /**
   * 构造自定义模型默认值，避免新增入口散落字段定义
   */
  private build_custom_model(model_type: CustomModelType): JsonRecord {
    const template_path = path.join(
      this.paths.get_model_preset_dir(),
      Model.resolve_template_filename(model_type),
    );
    const template = this.read_json_file(template_path, {});
    const model = { ...read_json_record(template) };
    model["id"] = crypto.randomUUID();
    model["type"] = model_type;
    return this.normalize_model(model as JsonRecord);
  }

  /**
   * 归一模型对象，保护配置文件旧字段和缺省字段；已有 ID 不重新取 UUID，避免初始化消耗新增模型的确定 ID
   */
  private normalize_model(model: JsonRecord): JsonRecord {
    const existing_id = String(model["id"] ?? "").trim();
    const fallback_id = existing_id === "" ? crypto.randomUUID() : existing_id;
    return Model.from_json(model, fallback_id).to_json() as JsonRecord;
  }

  /**
   * 仅应用允许字段，防止模型配置被任意键污染
   */
  private apply_patch(model: JsonRecord, patch: JsonRecord): JsonRecord {
    const result = { ...model };
    for (const [key, value] of Object.entries(patch)) {
      if (PATCH_OBJECT_KEYS.has(key)) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new AppErrors.RequestValidationError({
            public_details: { field: key },
          });
        }
        if (
          key === "agent" &&
          Object.keys(value).some((field) => !MODEL_AGENT_PATCH_KEYS.has(field))
        ) {
          throw new AppErrors.RequestValidationError({
            public_details: { field: "agent" },
          });
        }
        result[key] = {
          ...read_json_record(result[key]),
          ...value,
        };
      } else {
        result[key] = String(value ?? "");
      }
    }
    if (patch["agent"] !== undefined && parse_model_agent_config(result["agent"]) === null) {
      throw new AppErrors.RequestValidationError({
        public_details: { field: "agent" },
      });
    }
    return this.normalize_model(result);
  }

  /**
   * 按 sort_index 排序模型，保持配置和页面顺序一致
   */
  private sort_models(models: JsonRecord[]): JsonRecord[] {
    return [...models].sort((a, b) => {
      return Model.resolve_type_sort_order(a["type"]) - Model.resolve_type_sort_order(b["type"]);
    });
  }

  /**
   * 查找模型位置并给出业务错误，避免静默错写
   */
  private find_model_index_or_raise(models: JsonRecord[], model_id: string): number {
    const index = models.findIndex((model) => String(model["id"] ?? "") === model_id);
    if (index < 0) {
      throw new AppErrors.ModelNotFoundError();
    }
    return index;
  }

  /** 所有按用途模型命令共用同一公开值域校验。 */
  private read_model_usage(value: unknown): ModelUsage {
    const usage = MODEL_USAGES.find((candidate) => candidate === value);
    if (usage === undefined) {
      throw new AppErrors.RequestValidationError({
        public_details: { field: "usage" },
      });
    }
    return usage;
  }

  /**
   * 删除已选模型时按同类型、预设、列表首项的顺序重选
   */
  private pick_selection_fallback(models: JsonRecord[], target_type: string): JsonRecord | null {
    return (
      models.find((model) => String(model["type"] ?? "") === target_type) ??
      models.find((model) => String(model["type"] ?? "") === "PRESET") ??
      models[0] ??
      null
    );
  }

  /** 只保留仍存在的模型 ID，失效用途统一回退排序后的首项。 */
  private normalize_selection_for_models(config: JsonRecord, models: JsonRecord[]): ModelSelection {
    const selection = normalize_model_selection(config["model_selection"]);
    const available_ids = new Set(models.map((model) => String(model["id"] ?? "")));
    const fallback_id = String(models[0]?.["id"] ?? "");
    for (const usage of MODEL_USAGES) {
      if (!available_ids.has(selection[usage])) {
        selection[usage] = fallback_id;
      }
    }
    return selection;
  }

  /**
   * 重排单个模型分组，集中校验完整性和 sort_index
   */
  private reorder_group(
    models: JsonRecord[],
    model_type: string,
    ordered_ids: string[],
  ): JsonRecord[] {
    const by_id = new Map(models.map((model) => [String(model["id"] ?? ""), model] as const));
    let group_index = 0;
    return models.map((model) => {
      if (String(model["type"] ?? "PRESET") !== model_type) {
        return model;
      }
      const model_id = ordered_ids[group_index] ?? String(model["id"] ?? "");
      group_index += 1;
      return by_id.get(model_id) ?? model;
    });
  }

  /**
   * 生成模型页管理快照，隔离配置内部结构
   */
  private build_snapshot_response(config: JsonRecord): JsonRecord {
    const models = read_config_model_records(config);
    return {
      snapshot: {
        models: models as unknown as JsonValue,
      },
    };
  }

  /** 生成任务入口需要的窄快照，只公开模型选择与直接控制所需的非敏感配置。 */
  private build_selection_snapshot(config: JsonRecord): JsonRecord {
    return {
      model_selection: normalize_model_selection(config["model_selection"]),
      models: read_config_model_records(config).map((model) => ({
        id: String(model["id"] ?? ""),
        type: String(model["type"] ?? ""),
        name: String(model["name"] ?? ""),
        agent: read_json_record(model["agent"]),
        thinking_level: Model.normalize_thinking_level(
          read_json_record(model["thinking"])["level"],
        ),
        thinking_configurable: Model.api_format_supports_thinking_configuration(
          Model.normalize_api_format(model["api_format"]),
        ),
      })),
    };
  }

  /**
   * 读取 JSON 文件并转换为对象，统一坏文件兜底
   */
  private read_json_file(file_path: string, fallback: JsonValue): JsonValue {
    try {
      return JsonTool.parseStrict<JsonValue>(this.native_fs.read_file(file_path));
    } catch {
      return fallback;
    }
  }
}
