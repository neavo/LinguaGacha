import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import { JsonTool } from "../../shared/utils/json-tool";
import type { AgentSkillDefinition } from "./agent-skills";

const READ_SKILL_REFERENCE_PARAMETERS = Type.Object(
  {
    reference: Type.String({ description: "reference_index 中列出的文件名" }),
  },
  { additionalProperties: false },
);

/**
 * 技能渐进加载闭环工具：让模型按 reference_index 拉取当前激活技能的 references 正文。
 * 白名单收口在当前 runtime.skill.references，不接受路径，杜绝目录穿越与跨技能读取。
 */
export function create_skill_reference_tools(
  get_skill: () => AgentSkillDefinition | null,
): AgentTool[] {
  return [
    {
      name: "read_skill_reference",
      label: "读技能参考",
      description: "读取当前技能 reference_index 中列出的某个参考文件正文。",
      parameters: READ_SKILL_REFERENCE_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const reference_name = String((params as { reference: string }).reference ?? "").trim();
        const skill = get_skill();
        if (skill === null) throw new Error("当前没有激活技能");
        const entry = skill.references.find((candidate) => candidate.file_name === reference_name);
        if (entry === undefined) {
          const available = skill.references.map((candidate) => candidate.file_name);
          throw new Error(
            `参考文件不存在或未加载：${reference_name}（可用：${available.join(", ") || "无"}）`,
          );
        }
        return tool_result({
          reference: entry.file_name,
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
