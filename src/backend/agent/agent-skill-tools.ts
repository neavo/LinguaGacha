import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

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

/**
 * 只读取启动期固定的 skill 白名单；manual-only skill 必须先由用户显式引用。
 */
export function create_agent_skill_tools(
  skills: readonly AgentSkillDefinition[],
  is_explicitly_invoked: (name: string) => boolean,
): AgentTool[] {
  if (skills.length === 0) return [];
  return [
    {
      name: "read_skill",
      label: "读技能",
      description: "读取可自动调用或当前会话已显式引用 skill 的 SKILL.md 与参考正文。",
      parameters: READ_SKILL_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const request = params as { path: string };
        const resource = resolve_skill_resource(skills, is_explicitly_invoked, request.path);
        if (resource === null) {
          throw new Error(`技能文件不存在或当前会话不可读取：${request.path}`);
        }
        return tool_result({
          skill: resource.skill,
          path: resource.filePath,
          content: resource.content,
        });
      },
    },
  ];
}

/** 按启动期快照和 manual-only 授权解析唯一可读资源。 */
function resolve_skill_resource(
  skills: readonly AgentSkillDefinition[],
  is_explicitly_invoked: (name: string) => boolean,
  file_path: string,
): AgentSkillResource | null {
  for (const skill of skills) {
    if (skill.disableModelInvocation && !is_explicitly_invoked(skill.name)) continue;
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
