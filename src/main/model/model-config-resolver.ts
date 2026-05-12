import type { ApiJsonValue } from "../api/api-types";

export type ModelRecord = Record<string, ApiJsonValue>;

/**
 * 读取配置中的模型列表，集中保护旧配置或坏配置里混入的非对象项。
 */
export function read_model_records(config: Record<string, ApiJsonValue>): ModelRecord[] {
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
 * 复刻历史设置文件中的激活模型选择规则，避免服务端出现第二套口径。
 */
export function resolve_active_model(config: Record<string, ApiJsonValue>): ModelRecord | null {
  const models = read_model_records(config);
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
 * 返回运行时实际会采用的模型 id，供页面快照和任务预检共享。
 */
export function resolve_active_model_id(config: Record<string, ApiJsonValue>): string {
  return String(resolve_active_model(config)?.["id"] ?? "");
}
