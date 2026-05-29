import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { NativeFs, default_native_fs } from "../../native/native-fs";

export type ModelRecord = Record<string, ApiJsonValue>;

interface ModelPresetPathReader {
  get_model_preset_dir: () => string; // get_model_preset_dir 让模型服务和 Bootstrap 共用同一内置预设目录事实
}

/**
 * 读取配置中的模型列表，集中保护旧配置或坏配置里混入的非对象项
 */
export function read_config_model_records(config: Record<string, ApiJsonValue>): ModelRecord[] {
  const raw_models = config["models"];
  if (!Array.isArray(raw_models)) {
    return [];
  }
  return raw_models
    .filter((item): item is ModelRecord => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    })
    .map((item) => ({ ...item }));
}

/**
 * 复刻历史设置文件中的激活模型选择规则，避免服务端出现第二套口径
 */
export function resolve_active_model(config: Record<string, ApiJsonValue>): ModelRecord | null {
  const models = read_config_model_records(config);
  const active_model_id = String(config["activate_model_id"] ?? "").trim();
  if (active_model_id !== "") {
    const active_model = models.find((model) => {
      return String(model["id"] ?? "") === active_model_id;
    });
    if (active_model !== undefined) {
      return active_model;
    }
  }
  return models[0] ?? null;
}

/**
 * 返回运行时实际会采用的模型 id，供页面快照和任务预检共享
 */
export function resolve_active_model_id(config: Record<string, ApiJsonValue>): string {
  return String(resolve_active_model(config)?.["id"] ?? "");
}

/**
 * 读取内置模型预设，供模型初始化和启动期系统代理快照共用同一资源口径。
 */
export function read_config_model_preset_records(
  paths: ModelPresetPathReader,
  native_fs: NativeFs = default_native_fs,
): ModelRecord[] {
  const preset_path = path.join(paths.get_model_preset_dir(), "preset_model_builtin.json");
  let data: ApiJsonValue = [];
  try {
    data = JsonTool.parseStrict<ApiJsonValue>(native_fs.read_file(preset_path));
  } catch {
    data = [];
  }
  return Array.isArray(data)
    ? data.filter(
        (item): item is ModelRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}
