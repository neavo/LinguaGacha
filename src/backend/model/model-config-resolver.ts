import path from "node:path";

import { is_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { Model, normalize_model_selection, type ModelUsage } from "../../domain/model";
import { AppError } from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";
import { NativeFs, default_native_fs } from "../../native/native-fs";

interface ModelPresetPathReader {
  get_model_preset_dir: () => string; // 只依赖预设目录能力，不把读取规则绑定到完整 AppPathService
}

/**
 * 读取配置中的模型列表，集中保护旧配置或坏配置里混入的非对象项
 */
export function read_config_model_records(config: JsonRecord): JsonRecord[] {
  const raw_models = config["models"];
  if (!Array.isArray(raw_models)) {
    return [];
  }
  return raw_models.filter(is_json_record).map((item) => ({ ...item }));
}

/**
 * 按执行用途解析模型；失效选择统一回退当前排序后的首项
 */
export function resolve_model_for_usage(config: JsonRecord, usage: ModelUsage): JsonRecord | null {
  const models = read_config_model_records(config);
  const selected_model_id = normalize_model_selection(config["model_selection"])[usage];
  const selected_model = models.find(
    (model) => selected_model_id !== "" && String(model["id"] ?? "") === selected_model_id,
  );
  const model = selected_model ?? models[0];
  return model === undefined
    ? null
    : (Model.from_json(model, String(model["id"] ?? "")).to_json() as JsonRecord);
}

/** 跟随时使用 Agent 已生效的配置；显式选择按模型自身保存配置执行。 */
export function resolve_agent_batch_translation_model(
  config: JsonRecord,
  agent_model: Model,
): Model {
  const model_id = normalize_model_selection(config["model_selection"]).agent_batch_translation;
  if (model_id === null) return agent_model;
  const model = read_config_model_records(config).find((item) => item["id"] === model_id);
  if (model === undefined) throw new AppError("model.not_found");
  return Model.from_json(model, model_id);
}

/**
 * 内置目录同时决定初始化与重置权限；损坏资源必须报错，避免被当作预设下架。
 */
export function read_config_model_preset_records(
  paths: ModelPresetPathReader,
  native_fs: NativeFs = default_native_fs,
): JsonRecord[] {
  const preset_path = path.join(paths.get_model_preset_dir(), "preset_model_builtin.json");
  let data: JsonValue;
  try {
    data = JsonTool.parseStrict<JsonValue>(native_fs.read_file(preset_path));
  } catch (error) {
    throw new AppError(error instanceof SyntaxError ? "file.parse_failed" : "file.io_failed", {
      cause: error,
      diagnostic_context: { path: preset_path },
    });
  }
  if (!Array.isArray(data)) {
    throw new AppError("file.invalid_structure", { diagnostic_context: { path: preset_path } });
  }
  const ids = new Set<string>();
  return data.map((item) => {
    if (
      !is_json_record(item) ||
      typeof item["id"] !== "string" ||
      item["id"] === "" ||
      item["id"].trim() !== item["id"] ||
      ids.has(item["id"])
    ) {
      throw new AppError("file.invalid_structure", { diagnostic_context: { path: preset_path } });
    }
    ids.add(item["id"]);
    return item;
  });
}
