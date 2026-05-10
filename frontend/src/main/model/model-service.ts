import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "../service/path-service";
import { ConfigService } from "../service/config-service";
import {
  read_model_records,
  resolve_active_model_id,
  type ModelRecord,
} from "./model-config-resolver";
import { JsonTool } from "../../shared/utils/json-tool";

const MODEL_TYPE_SORT_ORDER: Record<string, number> = {
  PRESET: 0,
  CUSTOM_GOOGLE: 1,
  CUSTOM_OPENAI: 2,
  CUSTOM_ANTHROPIC: 3,
};

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

const PATCH_OBJECT_KEYS = new Set(["thinking", "threshold", "generation", "request"]);

const TEMPLATE_FILENAME_BY_TYPE: Record<string, string> = {
  CUSTOM_GOOGLE: "preset_model_custom_google.json",
  CUSTOM_OPENAI: "preset_model_custom_openai.json",
  CUSTOM_ANTHROPIC: "preset_model_custom_anthropic.json",
};

const DEFAULT_REQUEST_CONFIG: Record<string, ApiJsonValue> = {
  extra_headers: {},
  extra_headers_custom_enable: false,
  extra_body: {},
  extra_body_custom_enable: false,
};

const DEFAULT_THRESHOLD_CONFIG: Record<string, ApiJsonValue> = {
  input_token_limit: 512,
  output_token_limit: 4096,
  rpm_limit: 0,
  concurrency_limit: 0,
};

const DEFAULT_THINKING_CONFIG: Record<string, ApiJsonValue> = {
  level: "OFF",
};

const DEFAULT_GENERATION_CONFIG: Record<string, ApiJsonValue> = {
  temperature: 0.95,
  temperature_custom_enable: false,
  top_p: 0.95,
  top_p_custom_enable: false,
  presence_penalty: 0,
  presence_penalty_custom_enable: false,
  frequency_penalty: 0,
  frequency_penalty_custom_enable: false,
};

/**
 * 封装 TS 侧模型配置 CRUD；任务执行时由 TS 传入模型快照给 Python LLM adapter。
 */
export class ModelService {
  private readonly paths: AppPathService;
  private readonly config_service: ConfigService;

  /**
   * 初始化 ModelService 依赖，保持外部写入口清晰。
   */
  public constructor(paths: AppPathService, config_service: ConfigService) {
    this.paths = paths;
    this.config_service = config_service;
  }

  /**
   * 读取模型页完整快照，供 UI 一次性恢复配置状态。
   */
  public get_snapshot(): Record<string, ApiJsonValue> {
    const config = this.load_config_with_models(true);
    return this.build_snapshot_response(config);
  }

  /**
   * 更新模型白名单字段，避免页面写入未知配置。
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
    const config = this.load_config_with_models(false);
    const models = read_model_records(config);
    const index = this.find_model_index_or_raise(models, model_id);
    models[index] = this.apply_patch(models[index] ?? {}, patch);
    config["models"] = models as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 切换指定分组激活模型，并保持 fallback 规则集中。
   */
  public async activate_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_config_with_models(false);
    const models = read_model_records(config);
    this.find_model_index_or_raise(models, model_id);
    config["activate_model_id"] = model_id;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 新增自定义模型，避免调用方复制默认字段补齐规则。
   */
  public async add_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_type = String(request["model_type"] ?? "");
    if (!(model_type in TEMPLATE_FILENAME_BY_TYPE)) {
      throw new Error(`unknown model type: ${model_type}`);
    }
    const config = this.load_config_with_models(false);
    const models = read_model_records(config);
    models.push(this.build_custom_model(model_type));
    config["models"] = models as unknown as ApiJsonValue;
    return this.persist_config_and_build_snapshot(config);
  }

  /**
   * 删除模型并重选激活项，防止配置留下悬空引用。
   */
  public async delete_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_config_with_models(false);
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
   * 用内置预设重置模型，保持 preset 事实来自资源目录。
   */
  public async reset_preset_model(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const model_id = String(request["model_id"] ?? "");
    const config = this.load_config_with_models(false);
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
   * 重排同组模型，确保 ordered ids 完整覆盖当前分组。
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
    const config = this.load_config_with_models(false);
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
   * 保存配置后立即重建快照，保证响应反映持久化结果。
   */
  private async persist_config_and_build_snapshot(
    config: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    config["models"] = this.sort_models(read_model_records(config)) as unknown as ApiJsonValue;
    this.config_service.save_config(config);
    return this.build_snapshot_response(config);
  }

  /**
   * 读取配置并补齐模型列表，兼容缺失或旧格式配置。
   */
  private load_config_with_models(persist_defaults: boolean): Record<string, ApiJsonValue> {
    const config = this.config_service.load_config();
    config["models"] = this.initialize_models(
      read_model_records(config),
    ) as unknown as ApiJsonValue;
    const active_model_id = resolve_active_model_id(config);
    if (String(config["activate_model_id"] ?? "") === "" && active_model_id !== "") {
      config["activate_model_id"] = active_model_id;
    }
    if (persist_defaults) {
      this.config_service.save_config(config);
    }
    return config;
  }

  /**
   * 初始化模型集合，合并用户配置和内置预设。
   */
  private initialize_models(existing_models: ModelRecord[]): ModelRecord[] {
    const models = existing_models.map((model) => this.normalize_model(model));
    const existing_ids = new Set(models.map((model) => String(model["id"] ?? "")));
    for (const preset of this.load_preset_models()) {
      if (!existing_ids.has(String(preset["id"] ?? ""))) {
        models.push(this.normalize_model(preset));
      }
    }
    for (const model_type of Object.keys(TEMPLATE_FILENAME_BY_TYPE)) {
      if (!models.some((model) => String(model["type"] ?? "") === model_type)) {
        models.push(this.build_custom_model(model_type));
      }
    }
    return models;
  }

  /**
   * 读取内置模型预设，保持 UI 语言不影响模型集合。
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
   * 构造自定义模型默认值，避免新增入口散落字段定义。
   */
  private build_custom_model(model_type: string): ModelRecord {
    const template_path = path.join(
      this.paths.get_model_preset_dir(),
      TEMPLATE_FILENAME_BY_TYPE[model_type] ?? "",
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
   * 归一模型对象，保护配置文件旧字段和缺省字段。
   */
  private normalize_model(model: ModelRecord): ModelRecord {
    return {
      id: String(model["id"] ?? crypto.randomUUID()),
      type: String(model["type"] ?? "PRESET"),
      name: String(model["name"] ?? ""),
      api_format: String(model["api_format"] ?? "OpenAI"),
      api_url: String(model["api_url"] ?? ""),
      api_key: String(model["api_key"] ?? "no_key_required"),
      model_id: String(model["model_id"] ?? ""),
      request: this.normalize_object_with_defaults(model["request"], DEFAULT_REQUEST_CONFIG),
      threshold: this.normalize_object_with_defaults(model["threshold"], DEFAULT_THRESHOLD_CONFIG),
      thinking: this.normalize_object_with_defaults(model["thinking"], DEFAULT_THINKING_CONFIG),
      generation: this.normalize_object_with_defaults(
        model["generation"],
        DEFAULT_GENERATION_CONFIG,
      ),
    };
  }

  /**
   * 收窄未知 JSON 为对象，避免深层读取抛出隐式异常。
   */
  private normalize_object(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 仅应用允许字段，防止模型配置被任意键污染。
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
   * 用默认值补齐对象字段，兼容部分写入的历史配置。
   */
  private normalize_object_with_defaults(
    value: ApiJsonValue | undefined,
    defaults: Record<string, ApiJsonValue>,
  ): Record<string, ApiJsonValue> {
    return {
      ...defaults,
      ...this.normalize_object(value),
    };
  }

  /**
   * 按 sort_index 排序模型，保持配置和页面顺序一致。
   */
  private sort_models(models: ModelRecord[]): ModelRecord[] {
    return [...models].sort((a, b) => {
      return (
        (MODEL_TYPE_SORT_ORDER[String(a["type"] ?? "")] ?? 99) -
        (MODEL_TYPE_SORT_ORDER[String(b["type"] ?? "")] ?? 99)
      );
    });
  }

  /**
   * 查找模型位置并给出业务错误，避免静默错写。
   */
  private find_model_index_or_raise(models: ModelRecord[], model_id: string): number {
    const index = models.findIndex((model) => String(model["id"] ?? "") === model_id);
    if (index < 0) {
      throw new Error("model not found");
    }
    return index;
  }

  /**
   * 选择激活模型兜底，避免删除后留下不可用分组。
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
   * 重排单个模型分组，集中校验完整性和 sort_index。
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
   * 生成模型页响应快照，隔离配置内部结构。
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
   * 读取 JSON 文件并转换为对象，统一坏文件兜底。
   */
  private read_json_file(file_path: string, fallback: ApiJsonValue): ApiJsonValue {
    try {
      return JsonTool.parseStrict<ApiJsonValue>(fs.readFileSync(file_path));
    } catch {
      return fallback;
    }
  }
}
