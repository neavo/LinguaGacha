import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AgentSkillDefinition } from "./agent-skills";
import { AgentToolError, agent_tool_result } from "./agent-tool";

const READ_SKILL_PARAMETERS = Type.Object(
  {
    path: Type.String({
      description:
        "要读取的精确路径：必须是 available_skills 给出的 location，或已读取技能正文引用的 Markdown 路径；不能用于任意文件。",
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
      description:
        "读取启动期已加载且列入白名单的技能正文或其参考文件。path 必须精确来自 available_skills，或来自此前已读取正文中的引用；不能读取任意本地文件。返回 skill、规范化 path 与 content，只读且不修改资源。",
      parameters: READ_SKILL_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const resource = resolve_skill_resource(skills, params.path);
        if (resource === null) {
          throw new AgentToolError({ code: "skill.resource_not_allowed", path: params.path });
        }
        return agent_tool_result({
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
