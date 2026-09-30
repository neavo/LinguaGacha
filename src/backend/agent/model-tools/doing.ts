import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

import { read_json_record } from "../../../domain/json";
import { AGENT_DOING_TEXT_LIMIT, normalize_agent_doing } from "../../../shared/agent-doing";
import { agent_tool_result, AgentToolError } from "./definition";

/** 正在处理的内容直接写入会话，运行状态由宿主独立维护。 */
export function create_agent_doing_tool(write: (text: string | null) => void) {
  return defineTool({
    name: "doing",
    label: "更新「正在处理」UI 组件的状态",
    description: "新文本覆盖，完成、放弃或结束处理时传入 `null` 清空，内容跨回合保留。",
    executionMode: "sequential",
    parameters: Type.Object(
      {
        text: Type.Union([
          Type.String({
            minLength: 1,
            maxLength: AGENT_DOING_TEXT_LIMIT,
            description: "正在处理的任务阶段，用简短的「动作 + 对象」表达。",
          }),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    /** 先校验原始参数，防止 SDK 将空字符串转换成 `null` 清空内容。 */
    prepareArguments: (value: unknown) => {
      try {
        const record = read_json_record(value);
        return { ...record, text: normalize_agent_doing(record["text"]) };
      } catch (cause) {
        throw new AgentToolError({ code: "invalid_doing" }, cause);
      }
    },
    /** SDK 已完成参数准备，取消检查通过后同步写入会话。 */
    execute: async (_tool_call_id, params, signal) => {
      signal?.throwIfAborted();
      const { text } = params;
      write(text);
      return agent_tool_result({ text });
    },
  });
}
