import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { normalize_setting_snapshot } from "../../domain/setting";
import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectSessionState } from "../project/project-session-state";
import { agent_tool_result } from "./agent-tool";

const QUERY_PROJECT_META_PARAMETERS = Type.Object({}, { additionalProperties: false }); // 工程身份来自会话，不接受模型输入

/** 工程会话守卫与应用设置共同构成语言事实读取边界。 */
type AgentProjectDependencies = {
  settings: Pick<AppSettingService, "read_setting">;
  sessionState: Pick<ProjectSessionState, "require_loaded_project_path">;
};

/** 只向 Agent 暴露当前工程翻译工作流需要的权威语言。 */
export function create_agent_project_tools(
  dependencies: AgentProjectDependencies,
): ToolDefinition[] {
  return [
    defineTool({
      name: "query_project_meta",
      label: "查询工程信息",
      description: "查询当前工程审查与翻译使用的源语言和目标语言。",
      parameters: QUERY_PROJECT_META_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        dependencies.sessionState.require_loaded_project_path();
        const settings = normalize_setting_snapshot(dependencies.settings.read_setting());
        const details = {
          source_language: settings.source_language,
          target_language: settings.target_language,
        };
        return agent_tool_result(details);
      },
    }),
  ];
}
