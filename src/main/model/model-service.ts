import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "../service/path-service";
import { SettingService } from "../service/setting-service";
import { PiAiLlmRequestClient } from "../task-worker/llm/llm-request-client";
import type { LlmRequestMessage, LlmRequestResult } from "../task-worker/llm/llm-types";
import {
  collect_api_keys,
  get_primary_api_key,
  normalize_api_url,
} from "../task-worker/llm/llm-model-adapter";
import { Model, type ModelApiFormat } from "../../base/model";
import {
  read_model_records,
  resolve_active_model_id,
  type ModelRecord,
} from "./model-config-resolver";
import { JsonTool } from "../../shared/utils/json-tool";

// 模型页只允许写入这些配置字段，防止表单 patch 污染持久化模型对象
const PATCH_ALLOWED_KEYS = new Set([
  "name",
  "api_url",
  "api_key",
  "model_id",
  "thinking",
  "threshold",
  "generation",
  "request",
]);

// 嵌套配置字段采用浅合并，保留未出现在 patch 中的历史配置项
const PATCH_OBJECT_KEYS = new Set(["thinking", "threshold", "generation", "request"]);

// 模型列表探测沿用浏览器 UA，减少部分服务商对 Node 默认 UA 的拒绝概率
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

/**
 * 封装模型配置 CRUD；任务执行时由 Task Engine 传入模型快照给本地 LLM adapter
 */
export class ModelService {
  private readonly paths: AppPathService;
  private readonly setting_service: SettingService;

  /**
   * 初始化 ModelService 依赖，保持外部写入口清晰
   */
  public constructor(paths: AppPathService, setting_service: SettingService) {
    this.paths = paths;
    this.setting_service = setting_service;
  }

  /**
   * 读取模型页完整快照，供 UI 一次性恢复配置状态
   */
  public get_snapshot(): Record<string, ApiJsonValue> {
    const config = this.load_setting_with_models(true);
    return this.build_snapshot_response(config);
  }

  /**
   * 更新模型白名单字段，避免页面写入未知配置
   */
  public async update_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const patch_value = request["patch"];
    if (typeof patch_value !== "object" || patch_value === null || Array.isArray(patch_value)) {
      throw new Error("model patch must be a dict");
    }
    const patch = patch_value as ModelRecord;
    for (const key of Object.keys(patch)) {
      if (!PATCH_ALLOWED_KEYS.has(key)) {
        throw new Error(`forbidden model patch key: ${key}`);
      }
    }
    const config = this.load_setting_with_models(false);
    const models = read_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    models[index] = this.apply_patch(models[index] ?? {}, patch);
    config["models"] = models as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 切换指定分组激活模型，并保持 fallback 规则集中
   */
  public async activate_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_setting_with_models(false);
    const models = read_model_records(config);
    this.find_model_index_or_raise(models, model_id);
    config["activate_model_id"] = model_id;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 新增自定义模型，避免调用方复制默认字段补齐规则
   */
  public async add_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_type = String(request["model_type"] ?? "");
    if (Model.resolve_template_filename(model_type) === null) {
      throw new Error(`unknown model type: ${model_type}`);
    }
    const config = this.load_setting_with_models(false);
    const models = read_model_records(config);
    models.push(this.build_custom_model(model_type));
    config["models"] = models as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 删除模型并重选激活项，防止配置留下悬空引用
   */
  public async delete_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_setting_with_models(false);
    const models = read_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    const target_model = models[index] ?? {};
    if (String(target_model["type"] ?? "PRESET") === "PRESET") {
      throw new Error("preset model cannot be deleted");
    }
    models.splice(index, 1);
    if (String(config["activate_model_id"] ?? "") === model_id) {
      const fallback = this.pick_active_fallback(models, String(target_model["type"] ?? ""));
      config["activate_model_id"] = String(fallback?.["id"] ?? "");
    }
    config["models"] = models as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 用内置预设重置模型，保持 preset 事实来自资源目录
   */
  public async reset_preset_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_setting_with_models(false);
    const models = read_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    if (String(models[index]?.["type"] ?? "") !== "PRESET") {
      throw new Error("model is not preset");
    }
    const preset = this.load_preset_models().find((item) => String(item["id"] ?? "") === model_id);
    if (preset === undefined) {
      throw new Error("preset model not found");
    }
    models[index] = this.normalize_model(preset);
    config["models"] = models as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 重排同组模型，确保 ordered ids 完整覆盖当前分组
   */
  public async reorder_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const ordered_ids_raw = request["ordered_model_ids"];
    if (!Array.isArray(ordered_ids_raw)) {
      throw new Error("ordered_model_ids must be a list");
    }
    const ordered_ids = ordered_ids_raw.map((value) => String(value).trim()).filter(Boolean);
    if (ordered_ids.length === 0) {
      throw new Error("ordered_model_ids is empty");
    }
    const config = this.load_setting_with_models(false);
    const models = read_model_records(config);
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
      throw new Error("ordered_model_ids must match one model group exactly");
    }
    const reordered = this.reorder_group(models, model_type, ordered_ids);
    config["models"] = reordered as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 查询远端实时模型列表；pi-ai registry 只做内置参考，不替代用户 endpoint
   */
  public async list_available_models(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const config = this.load_setting_with_models(false);
    const model = this.get_model_from_request(config, request);
    const models = await this.fetch_available_models(model);
    return { models: models as unknown as ApiJsonValue };
  }

  /**
   * 模型连通性测试复用同一 LLM adapter，确保模型页和任务请求走同一策略
   */
  public async test_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const config = this.load_setting_with_models(false);
    const model = this.get_model_from_request(config, request);
    const keys = collect_api_keys(String(model["api_key"] ?? ""));
    const client = new PiAiLlmRequestClient({ appRoot: this.paths.get_app_root() });
    const key_results: Array<Record<string, ApiJsonValue>> = [];
    for (const api_key of keys) {
      const model_for_test = { ...model, api_key };
      const started_at = Date.now();
      const result = await client.request(
        {
          run_id: crypto.randomUUID(),
          work_unit_id: "model-test",
          model: model_for_test as unknown as ApiJsonValue,
          config_snapshot: config as unknown as ApiJsonValue,
          messages: this.build_model_test_messages(String(model["api_format"] ?? "OpenAI")),
        },
        new AbortController().signal,
      );
      const response_time_ms = Math.max(0, Date.now() - started_at);
      const error_reason = this.build_model_test_error_reason(result, config);
      key_results.push({
        masked_key: this.mask_api_key(api_key),
        success: error_reason === "",
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        response_time_ms,
        error_reason,
      });
    }
    const success_count = key_results.filter((item) => item["success"] === true).length;
    const failure_count = key_results.length - success_count;
    return {
      success: failure_count === 0,
      result_msg: `模型测试完成：总计 ${key_results.length.toString()}，成功 ${success_count.toString()}，失败 ${failure_count.toString()}`,
      total_count: key_results.length,
      success_count,
      failure_count,
      total_response_time_ms: key_results.reduce(
        (sum, item) => sum + this.read_response_time_ms(item["response_time_ms"]),
        0,
      ),
      key_results: key_results as unknown as ApiJsonValue,
    };
  }

  /**
   * 请求中的 model_id 只作为配置索引，不直接信任页面传入完整模型
   */
  private get_model_from_request(
    config: Record<string, ApiJsonValue>,
    request: Record<string, ApiJsonValue>,
  ): ModelRecord {
    const model_id = String(request["model_id"] ?? "");
    const models = read_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    return models[index] ?? {};
  }

  /**
   * 按旧模型探测语义查询远端 live list，错误统一转换为模型页可展示文案
   */
  private async fetch_available_models(model: ModelRecord): Promise<string[]> {
    try {
      const api_format = this.read_model_api_format(model);
      if (api_format === "Google") {
        return await this.fetch_google_available_models(model);
      }
      if (api_format === "Anthropic") {
        return await this.fetch_anthropic_available_models(model);
      }
      return await this.fetch_openai_available_models(model, api_format);
    } catch (error) {
      throw new Error("获取模型列表失败，请检查接口配置。", { cause: error });
    }
  }

  /**
   * OpenAI-compatible 与 Sakura 都复用 `/models` 列表语义
   */
  private async fetch_openai_available_models(
    model: ModelRecord,
    api_format: ModelApiFormat,
  ): Promise<string[]> {
    const api_url = normalize_api_url(String(model["api_url"] ?? ""), api_format);
    const data = await this.fetch_json(`${api_url}/models`, {
      Authorization: `Bearer ${get_primary_api_key(String(model["api_key"] ?? ""))}`,
      ...this.build_browser_headers(model),
    });
    return this.read_model_id_array(data, "data", "id");
  }

  /**
   * Google list 接口要求 key 放在 query，baseUrl 可携带 v1/v1beta
   */
  private async fetch_google_available_models(model: ModelRecord): Promise<string[]> {
    const api_url = normalize_api_url(String(model["api_url"] ?? ""), "Google");
    const base_url = api_url === "" ? "https://generativelanguage.googleapis.com/v1beta" : api_url;
    const target_url = new URL(`${base_url}/models`);
    target_url.searchParams.set("key", get_primary_api_key(String(model["api_key"] ?? "")));
    const data = await this.fetch_json(target_url.toString(), this.build_browser_headers(model));
    return this.read_model_id_array(data, "models", "name");
  }

  /**
   * Anthropic models.list 使用 `/v1/models` 与 x-api-key header
   */
  private async fetch_anthropic_available_models(model: ModelRecord): Promise<string[]> {
    const api_url = normalize_api_url(String(model["api_url"] ?? ""), "Anthropic");
    const base_url = api_url === "" ? "https://api.anthropic.com" : api_url;
    const data = await this.fetch_json(`${base_url}/v1/models`, {
      "anthropic-version": "2023-06-01",
      "x-api-key": get_primary_api_key(String(model["api_key"] ?? "")),
      ...this.build_browser_headers(model),
    });
    return this.read_model_id_array(data, "data", "id");
  }

  /**
   * fetch 只负责 HTTP 细节，模型列表字段解释留在调用点
   */
  private async fetch_json(url: string, headers: Record<string, string>): Promise<ApiJsonValue> {
    const response = await fetch(url, { headers, method: "GET" });
    if (!response.ok) {
      throw new Error(`模型列表 HTTP ${response.status.toString()}`);
    }
    return (await response.json()) as ApiJsonValue;
  }

  /**
   * 读取 SDK list 常见数组结构，坏项直接跳过
   */
  private read_model_id_array(data: ApiJsonValue, array_key: string, id_key: string): string[] {
    const record = this.normalize_object(data);
    const items = record[array_key];
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => this.normalize_object(item)[id_key])
      .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  }

  /**
   * 模型列表沿用浏览器 UA，并合并用户自定义额外 header
   */
  private build_browser_headers(model: ModelRecord): Record<string, string> {
    const headers: Record<string, string> = { "User-Agent": BROWSER_USER_AGENT };
    const request_config = this.normalize_object(model["request"]);
    if (request_config["extra_headers_custom_enable"] !== true) {
      return headers;
    }
    const extra_headers = this.normalize_object(request_config["extra_headers"]);
    for (const [key, value] of Object.entries(extra_headers)) {
      headers[key] = String(value);
    }
    return headers;
  }

  /**
   * 模型测试提示词保持旧入口语义，Sakura 继续走纯文本翻译请求
   */
  private build_model_test_messages(api_format: string): LlmRequestMessage[] {
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
   * 把 LLM 原始请求事实转换为模型页测试失败原因
   */
  private build_model_test_error_reason(
    result: LlmRequestResult,
    config: Record<string, ApiJsonValue>,
  ): string {
    if (result.cancelled) {
      return "请求已取消。";
    }
    if (result.timeout) {
      return `请求超时（${String(config["request_timeout"] ?? 120)} 秒）。`;
    }
    if (result.degraded) {
      return "流式响应退化。";
    }
    return result.error;
  }

  /**
   * API 格式缺失时按 OpenAI-compatible 处理
   */
  private read_model_api_format(model: ModelRecord): ModelApiFormat {
    const value = String(model["api_format"] ?? "OpenAI");
    return Model.normalize_api_format(value);
  }

  /**
   * API Key 日志与响应只展示脱敏结果，避免页面 toast 泄露密钥
   */
  private mask_api_key(key: string): string {
    const normalized_key = key.trim();
    if (normalized_key.length <= 16) {
      return normalized_key;
    }
    return `${normalized_key.slice(0, 8)}${"*".repeat(normalized_key.length - 16)}${normalized_key.slice(-8)}`;
  }

  /**
   * 测试耗时来自本地计时，仍在边界处收窄一次以防响应结构被误改
   */
  private read_response_time_ms(value: ApiJsonValue | undefined): number {
    const number_value = Number(value ?? 0);
    return Number.isFinite(number_value) ? Math.max(0, Math.trunc(number_value)) : 0;
  }

  /**
   * 保存配置后立即重建快照，保证响应反映持久化结果
   */
  private async persist_config_and_build_snapshot(
    config: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    config["models"] = this.sort_models(read_model_records(config)) as unknown as ApiJsonValue;
    this.setting_service.save_setting(config);
    return this.build_snapshot_response(config);
  }

  /**
   * 读取配置并补齐模型列表，兼容缺失或旧格式配置
   */
  private load_setting_with_models(persist_defaults: boolean): Record<string, ApiJsonValue> {
    const config = this.setting_service.load_setting();
    config["models"] = this.initialize_models(
      read_model_records(config),
    ) as unknown as ApiJsonValue;
    const active_model_id = resolve_active_model_id(config);
    if (String(config["activate_model_id"] ?? "") === "" && active_model_id !== "") {
      config["activate_model_id"] = active_model_id;
    }
    if (persist_defaults) {
      this.setting_service.save_setting(config);
    }
    return config;
  }

  /**
   * 初始化模型集合，合并用户配置和内置预设
   */
  private initialize_models(existing_models: ModelRecord[]): ModelRecord[] {
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
  private load_preset_models(): ModelRecord[] {
    const preset_path = path.join(this.paths.get_model_preset_dir(), "preset_model_builtin.json");
    const data = this.read_json_file(preset_path, []);
    return Array.isArray(data)
      ? data.filter(
          (item): item is ModelRecord =>
            typeof item === "object" && item !== null && !Array.isArray(item),
        )
      : [];
  }

  /**
   * 构造自定义模型默认值，避免新增入口散落字段定义
   */
  private build_custom_model(model_type: string): ModelRecord {
    const template_path = path.join(
      this.paths.get_model_preset_dir(),
      Model.resolve_template_filename(model_type) ?? "",
    );
    const template = this.read_json_file(template_path, {});
    const model =
      typeof template === "object" && template !== null && !Array.isArray(template)
        ? { ...template }
        : {};
    model["id"] = crypto.randomUUID();
    model["type"] = model_type;
    return this.normalize_model(model as ModelRecord);
  }

  /**
   * 归一模型对象，保护配置文件旧字段和缺省字段；已有 ID 不重新取 UUID，避免初始化消耗新增模型的确定 ID
   */
  private normalize_model(model: ModelRecord): ModelRecord {
    const existing_id = String(model["id"] ?? "").trim();
    const fallback_id = existing_id === "" ? crypto.randomUUID() : existing_id;
    return Model.from_json(model, fallback_id).to_json() as ModelRecord;
  }

  /**
   * 收窄未知 JSON 为对象，避免深层读取抛出隐式异常
   */
  private normalize_object(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 仅应用允许字段，防止模型配置被任意键污染
   */
  private apply_patch(model: ModelRecord, patch: ModelRecord): ModelRecord {
    const result = { ...model };
    for (const [key, value] of Object.entries(patch)) {
      if (PATCH_OBJECT_KEYS.has(key)) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new Error(`model patch field must be a dict: ${key}`);
        }
        result[key] = {
          ...this.normalize_object(result[key]),
          ...value,
        };
      } else {
        result[key] = String(value ?? "");
      }
    }
    return this.normalize_model(result);
  }

  /**
   * 按 sort_index 排序模型，保持配置和页面顺序一致
   */
  private sort_models(models: ModelRecord[]): ModelRecord[] {
    return [...models].sort((a, b) => {
      return Model.resolve_type_sort_order(a["type"]) - Model.resolve_type_sort_order(b["type"]);
    });
  }

  /**
   * 查找模型位置并给出业务错误，避免静默错写
   */
  private find_model_index_or_raise(models: ModelRecord[], model_id: string): number {
    const index = models.findIndex((model) => String(model["id"] ?? "") === model_id);
    if (index < 0) {
      throw new Error("model not found");
    }
    return index;
  }

  /**
   * 选择激活模型兜底，避免删除后留下不可用分组
   */
  private pick_active_fallback(models: ModelRecord[], target_type: string): ModelRecord | null {
    return (
      models.find((model) => String(model["type"] ?? "") === target_type) ??
      models.find((model) => String(model["type"] ?? "") === "PRESET") ??
      models[0] ??
      null
    );
  }

  /**
   * 重排单个模型分组，集中校验完整性和 sort_index
   */
  private reorder_group(
    models: ModelRecord[],
    model_type: string,
    ordered_ids: string[],
  ): ModelRecord[] {
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
   * 生成模型页响应快照，隔离配置内部结构
   */
  private build_snapshot_response(
    config: Record<string, ApiJsonValue>,
  ): Record<string, ApiJsonValue> {
    const models = read_model_records(config);
    return {
      snapshot: {
        active_model_id: resolve_active_model_id(config),
        models: models as unknown as ApiJsonValue,
      },
    };
  }

  /**
   * 读取 JSON 文件并转换为对象，统一坏文件兜底
   */
  private read_json_file(file_path: string, fallback: ApiJsonValue): ApiJsonValue {
    try {
      return JsonTool.parseStrict<ApiJsonValue>(fs.readFileSync(file_path));
    } catch {
      return fallback;
    }
  }
}
