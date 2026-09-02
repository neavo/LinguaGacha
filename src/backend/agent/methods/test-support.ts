import {
  is_json_record,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../../domain/json";
import { AGENT_WORKSPACE_CONTRACT } from "../workspace/contract";
import { execute_agent_workspace_method, type AgentWorkspaceMethodName } from "./registry";
import { create_agent_workspace_method_context, type AgentWorkspaceReadPort } from "../deno/data";

/** 测试验证方法遵循 contract 上限，而不复制当前可调数值。 */
export const WORKSPACE_QUERY_PAGE_MAX = Number(
  read_json_record(AGENT_WORKSPACE_CONTRACT["limits"])["query_page_max"],
);

/** 用真实类型化函数和最小只读文件端口验证领域方法的公开结果。 */
export async function execute_workspace_method(
  name: AgentWorkspaceMethodName,
  args: JsonRecord,
  files: Record<string, JsonValue>,
): Promise<JsonValue> {
  const workspace: AgentWorkspaceReadPort = {
    contract: AGENT_WORKSPACE_CONTRACT,
    iterateJsonl: async function* (file_path: string) {
      const rows = files[file_path];
      if (!Array.isArray(rows)) throw new Error(`Missing ${file_path}`);
      for (const row of rows) {
        if (!is_json_record(row)) throw new Error(`Invalid ${file_path}`);
        yield row;
      }
    },
  };
  return await execute_agent_workspace_method(
    name,
    create_agent_workspace_method_context(workspace),
    args,
  );
}

/** 构造完整条目，场景只覆盖与当前判断有关的字段。 */
export function workspace_item(item_id: number, overrides: JsonRecord = {}): JsonRecord {
  return {
    item_id,
    fp: "abcd",
    src: `原文 ${item_id.toString()}`,
    name_src: "",
    dst: "",
    name_dst: "",
    status: "NONE",
    file_path: "script.txt",
    text_type: "NONE",
    row_number: item_id,
    retry_count: 0,
    ...overrides,
  };
}

/** 构造已落盘 glossary 条目，验证方法对 id 到 entry_id 的边界投影。 */
export function glossary_entry(id: string, src: string): JsonRecord {
  return { id, src, dst: "译文", info: "", case_sensitive: false };
}

/** 构造由 scratch 投影的候选条目，不引入与结构聚类无关的字段。 */
export function relation_candidate(entry_id: string, src: string): JsonRecord {
  return { entry_id, src, case_sensitive: false };
}
