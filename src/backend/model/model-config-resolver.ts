import path from "node:path";

import { is_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { normalize_model_selection, type ModelUsage } from "../../domain/model";
import { JsonTool } from "../../shared/utils/json-tool";
import { NativeFs, default_native_fs } from "../../native/native-fs";

interface ModelPresetPathReader {
  get_model_preset_dir: () => string; // 让模型服务和 Bootstrap 共用同一内置预设目录事实
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
  if (selected_model_id !== "") {
    const selected_model = models.find((model) => {
      return String(model["id"] ?? "") === selected_model_id;
    });
    if (selected_model !== undefined) {
      return selected_model;
    }
  }
  return models[0] ?? null;
}

/**
 * 读取内置模型预设，供模型初始化和启动期系统代理快照共用同一资源口径。
 */
export function read_config_model_preset_records(
  paths: ModelPresetPathReader,
  native_fs: NativeFs = default_native_fs,
): JsonRecord[] {
  const preset_path = path.join(paths.get_model_preset_dir(), "preset_model_builtin.json");
  let data: JsonValue = [];
  try {
    data = JsonTool.parseStrict<JsonValue>(native_fs.read_file(preset_path));
  } catch {
    data = [];
  }
  return Array.isArray(data) ? data.filter(is_json_record) : [];
}
