import { is_json_record, type JsonRecord } from "../domain/json";
import {
  is_model_type,
  normalize_model_selection,
  parse_model_agent_config,
  type ModelAgentConfig,
  type ModelSelection,
  type ModelType,
} from "../domain/model";

/** 任务入口可见的非敏感模型摘要。 */
export type ModelSelectionOption = JsonRecord & {
  id: string;
  type: ModelType;
  name: string;
  agent: ModelAgentConfig; // Agent 空会话展示当前模型容量所需的非敏感配置
};

/** renderer 查询与选择命令共用的公开快照。 */
export type ModelSelectionSnapshot = JsonRecord & {
  model_selection: ModelSelection;
  models: ModelSelectionOption[];
};

/** GET 与 POST 回包统一收窄；除 Agent 容量外的模型配置不属于该协议。 */
export function normalize_model_selection_snapshot(value: unknown): ModelSelectionSnapshot {
  const record = is_json_record(value) ? value : {};
  const raw_models = Array.isArray(record["models"]) ? record["models"] : [];
  const models = raw_models.flatMap((item): ModelSelectionOption[] => {
    if (!is_json_record(item)) return [];
    const id = typeof item["id"] === "string" ? item["id"].trim() : "";
    const agent = parse_model_agent_config(item["agent"]);
    if (id === "" || !is_model_type(item["type"]) || agent === null) return [];
    return [
      {
        id,
        type: item["type"],
        name: typeof item["name"] === "string" ? item["name"].trim() : "",
        agent,
      },
    ];
  });
  return {
    model_selection: normalize_model_selection(record["model_selection"]),
    models,
  };
}
