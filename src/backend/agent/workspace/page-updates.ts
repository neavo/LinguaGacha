import { Check } from "typebox/value";
import { is_json_record } from "../../../domain/json";
import type { AgentWorkspacePageUpdateIntent } from "../../project/agent-workspace-page-write";
import type { AgentWorkspaceRejectedChange } from "../../project/agent-workspace-write";
import { AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA } from "./schema";
import { describe_agent_workspace_schema_error } from "./validation";

export { resolve_agent_workspace_page_updates } from "../../project/agent-workspace-page-write";

/** 预览和提交共用整行校验，保留物理行号及非法字段，避免投影后掩盖输入错误。 */
export function parse_page_update(row: {
  line: number;
  value: unknown;
  error?: string;
}): { intent: AgentWorkspacePageUpdateIntent } | { rejection: AgentWorkspaceRejectedChange } {
  if (row.error === undefined && Check(AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA, row.value))
    return { intent: { ...row.value, line: row.line } };
  const value = is_json_record(row.value) ? row.value : {};
  return {
    rejection: {
      scope: "pages",
      op: "update",
      reason: "invalid_change",
      line: row.line,
      ...(typeof value["file_path"] === "string" ? { file_path: value["file_path"] } : {}),
      ...(typeof value["page"] === "number" ? { page: value["page"] } : {}),
      ...(row.error === undefined
        ? describe_agent_workspace_schema_error(AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA, row.value)
        : { path: "/", message: row.error }),
    },
  };
}
