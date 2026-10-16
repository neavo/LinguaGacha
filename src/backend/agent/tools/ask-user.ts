import { Type, type Static } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import {
  AGENT_QUESTION_OPTION_MAX,
  AGENT_QUESTION_OPTION_MIN,
  AGENT_QUESTION_DESCRIPTION_LIMIT,
  AGENT_QUESTION_LABEL_LIMIT,
  AGENT_QUESTION_PROMPT_LIMIT,
  type AgentQuestion,
  type AgentQuestionOption,
} from "../../../shared/agent";
import { define_agent_tool, agent_tool_result, AgentToolError } from "../tool-definition";
import type { AgentQuestionResult } from "../agent-decision";

/** ask_user 与宿主决策协调器之间的窄等待端口。 */
export type AgentQuestionPort = {
  wait_for_answer: (
    tool_call_id: string,
    question: AgentQuestion,
    signal: AbortSignal | undefined,
  ) => Promise<AgentQuestionResult>;
};

const ASK_USER_PARAMETERS = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      maxLength: AGENT_QUESTION_PROMPT_LIMIT,
      description: "一句简短问题，说明需要用户决定的事情。",
    }),
    description: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: AGENT_QUESTION_DESCRIPTION_LIMIT,
        description: "各选项共用的简短背景或判断标准，不重复问题。",
      }),
    ),
    options: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, description: "当前问题内唯一的选项标识。" }),
          label: Type.String({
            minLength: 1,
            maxLength: AGENT_QUESTION_LABEL_LIMIT,
            description: "简短的可直接采用的行动或结果，选项之间含义明确不同。",
          }),
        },
        { additionalProperties: false },
      ),
      {
        description: "按推荐顺序排列的固定答案。",
        minItems: AGENT_QUESTION_OPTION_MIN,
        maxItems: AGENT_QUESTION_OPTION_MAX,
      },
    ),
  },
  { additionalProperties: false },
);

/** SDK 已按 Schema 校验长度与数量，这里只拒绝去除空白后为空的文本和重复的选项标识。 */
function normalize_question(params: Static<typeof ASK_USER_PARAMETERS>): AgentQuestion {
  const prompt = params.prompt.trim();
  const description = params.description?.trim();
  const options: AgentQuestionOption[] = params.options.map((option) => ({
    id: option.id.trim(),
    label: option.label.trim(),
  }));
  const [first, second, third] = options; // 解构供元组类型收窄，数量由 Schema 保证
  if (
    prompt === "" ||
    description === "" ||
    first === undefined ||
    second === undefined ||
    options.some(({ id, label }) => id === "" || label === "") ||
    new Set(options.map(({ id }) => id)).size !== options.length
  ) {
    throw new AgentToolError({ code: "invalid_question" });
  }
  return {
    prompt,
    ...(description === undefined ? {} : { description }),
    options: third === undefined ? [first, second] : [first, second, third],
  };
}

/** ask_user 把阻塞性决定交给宿主 UI，并将一次性结果返回当前工具轮次。 */
export function create_agent_ask_user_tool(question: AgentQuestionPort): ToolRegistration {
  return define_agent_tool({
    name: "ask_user",
    description: [
      "需要用户确定范围、处理策略或偏好时使用。问题应适合用简短选项表达。",
      "",
      "### 用户选择",
      "",
      "- 用户可以选择预设选项、输入自定义内容或取消。",
      "- 倒计时结束时默认采用第一项。",
      "",
      "### 结果处理",
      "",
      "|`outcome`|处理|",
      "|---|---|",
      "|`selected`|按 `optionId` 对应的选项执行|",
      "|`custom`|把 `text` 作为新的用户要求处理|",
      "|`cancelled`|暂停依赖该决定的动作，等待用户后续输入|",
    ].join("\n"),
    executionMode: "sequential",
    parameters: ASK_USER_PARAMETERS,
    execute: async (params, api, context) => {
      const tool_call_id = api.callId;
      const signal = context.abortSignal;
      const result = await question.wait_for_answer(
        tool_call_id,
        normalize_question(params),
        signal,
      );
      return agent_tool_result(result);
    },
  });
}
