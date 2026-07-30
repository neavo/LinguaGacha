import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import { JsonTool } from "../../shared/utils/json-tool";
import type { AgentSkillDefinition } from "./agent-skills";

const READ_SKILL_REFERENCE_PARAMETERS = Type.Object(
  {
    skill: Type.String({ description: "当前会话中已显式引用的 skill 名称" }),
    path: Type.String({ description: "相对 skill 根目录的 references/**/*.md 路径" }),
  },
  { additionalProperties: false },
);

/**
 * 技能渐进加载闭环工具：resolver 同时承担会话授权与 skill 查找，工具只匹配启动期白名单。
 */
export function create_skill_reference_tools(
  resolve_invoked_skill: (name: string) => AgentSkillDefinition | null,
): AgentTool[] {
  return [
    {
      name: "read_skill_reference",
      label: "读技能参考",
      description: "读取当前会话已显式引用 skill 的某个 references Markdown 正文。",
      parameters: READ_SKILL_REFERENCE_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const request = params as { skill: string; path: string };
        const skill = resolve_invoked_skill(request.skill);
        if (skill === null) throw new Error(`能力未在当前会话显式引用：${request.skill}`);
        const entry = skill.references.find((candidate) => candidate.path === request.path);
        if (entry === undefined) {
          const available = skill.references.map((candidate) => candidate.path);
          throw new Error(
            `参考文件不存在或未加载：${request.path}（可用：${available.join(", ") || "无"}）`,
          );
        }
        return tool_result({
          skill: skill.name,
          path: entry.path,
          content: entry.content,
        });
      },
    },
  ];
}

function tool_result(details: JsonRecord) {
  return Promise.resolve({
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  });
}
