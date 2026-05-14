import type { ApiJsonValue } from "../../api/api-types";

/** TaskArtifact 是 Engine 到 ProjectTaskStore 的唯一提交载荷，隔离数据库 operation 细节 */
export type TaskArtifact =
  | {
      kind: "item_updates";
      source: "translation";
      items: ApiJsonValue;
      affects_proofreading: boolean; // 重翻会推进 proofreading revision，普通翻译不会
    }
  | {
      kind: "analysis_checkpoints";
      checkpoints: ApiJsonValue;
    }
  | {
      kind: "analysis_candidates";
      entries: ApiJsonValue;
    };
