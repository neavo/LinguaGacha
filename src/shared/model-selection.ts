import { is_json_record, type JsonRecord } from "../domain/json";
import {
  Model,
  is_model_thinking_level,
  is_model_type,
  normalize_model_selection,
  type ModelSelection,
  type ModelThinkingLevel,
  type ModelType,
} from "../domain/model";
import { parse_model_agent_limits, type ModelAgentLimits } from "../domain/model-agent";

/** 任务入口可见的非敏感模型摘要。 */
export type ModelSelectionOption = JsonRecord & {
  id: string;
  type: ModelType;
  name: string;
  agent_limits: ModelAgentLimits; // Agent 空会话展示与运行时共用的实际容量
  thinking_level: ModelThinkingLevel; // 模型当前持久化的全局思考档位
  available_thinking_levels: ModelThinkingLevel[]; // 后端能力解析确认可直接下传的档位
};

/** renderer 查询与选择命令共用的公开快照。 */
export type ModelSelectionSnapshot = JsonRecord & {
  model_selection: ModelSelection;
  models: ModelSelectionOption[];
};

/** GET 与 POST 回包统一收窄，只接收任务入口直接控制所需的非敏感配置。 */
export function normalize_model_selection_snapshot(value: unknown): ModelSelectionSnapshot {
  const record = is_json_record(value) ? value : {};
  const raw_models = Array.isArray(record["models"]) ? record["models"] : [];
  const models = raw_models.flatMap((item): ModelSelectionOption[] => {
    if (!is_json_record(item)) return [];
    const id = typeof item["id"] === "string" ? item["id"].trim() : "";
    const agent_limits = parse_model_agent_limits(item["agent_limits"]);
    const available_thinking_levels = Array.isArray(item["available_thinking_levels"])
      ? item["available_thinking_levels"].filter(is_model_thinking_level)
      : [];
    if (id === "" || !is_model_type(item["type"]) || agent_limits === null) return [];
    return [
      {
        id,
        type: item["type"],
        name: typeof item["name"] === "string" ? item["name"].trim() : "",
        agent_limits,
        thinking_level: Model.normalize_thinking_level(item["thinking_level"]),
        available_thinking_levels,
      },
    ];
  });
  return {
    model_selection: normalize_model_selection(record["model_selection"]),
    models,
  };
}
