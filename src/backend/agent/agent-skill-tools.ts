import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { JsonTool } from "../../shared/utils/json-tool";
import type { AgentSkillDefinition } from "./agent-skills";

const READ_SKILL_PARAMETERS = Type.Object(
  {
    path: Type.String({
      description: "available_skills 中的 location，或其正文引用的绝对 Markdown 路径",
    }),
  },
  { additionalProperties: false },
);

type AgentSkillResource = {
  skill: string;
  filePath: string;
  content: string;
};

/** 读取工具只依赖 skill 的受控文件快照，不接触模型清单或 UI 描述。 */
type AgentSkillReadDefinition = Pick<
  AgentSkillDefinition,
  "name" | "filePath" | "content" | "references"
>;

/** 只读取启动期固定的 skill 白名单，模型清单可见性不构成文件权限。 */
export function create_agent_skill_tools(
  skills: readonly AgentSkillReadDefinition[],
): ToolDefinition[] {
  if (skills.length === 0) return [];
  return [
    defineTool({
      name: "read_skill",
      label: "读技能",
      description: "读取启动期已加载 skill 的 SKILL.md 与参考正文。",
      parameters: READ_SKILL_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const resource = resolve_skill_resource(skills, params.path);
        if (resource === null) {
          throw new Error(`技能文件不在启动期白名单：${params.path}`);
        }
        return tool_result({
          skill: resource.skill,
          path: resource.filePath,
          content: resource.content,
        });
      },
    }),
  ];
}

/** 按启动期快照解析唯一可读资源。 */
function resolve_skill_resource(
  skills: readonly AgentSkillReadDefinition[],
  file_path: string,
): AgentSkillResource | null {
  for (const skill of skills) {
    if (skill.filePath === file_path) {
      return { skill: skill.name, filePath: skill.filePath, content: skill.content };
    }
    const reference = skill.references.find((candidate) => candidate.filePath === file_path);
    if (reference !== undefined) {
      return { skill: skill.name, filePath: reference.filePath, content: reference.content };
    }
  }
  return null;
}

/** 工具正文和 details 共用同一严格 JSON 事实。 */
function tool_result(details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  };
}
