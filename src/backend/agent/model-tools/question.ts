import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  AGENT_QUESTION_OPTION_MAX,
  AGENT_QUESTION_OPTION_MIN,
  AGENT_QUESTION_DESCRIPTION_LIMIT,
  AGENT_QUESTION_LABEL_LIMIT,
  AGENT_QUESTION_PROMPT_LIMIT,
  type AgentQuestion,
  type AgentQuestionOption,
} from "../../../shared/agent";
import { agent_tool_result, AgentToolError } from "./definition";
import type { AgentQuestionResult } from "../agent-decision";

/** ask_user 与宿主决策协调器之间的窄等待端口。 */
export type AgentQuestionPort = {
  wait_for_answer: (
    tool_call_id: string,
    question: AgentQuestion,
    signal: AbortSignal | undefined,
  ) => Promise<AgentQuestionResult>;
};

const QUESTION_OPTION_PARAMETERS = Type.Object(
  {
    id: Type.String({ minLength: 1, description: "当前问题内唯一的选项标识。" }),
    label: Type.String({
      minLength: 1,
      maxLength: AGENT_QUESTION_LABEL_LIMIT,
      description: "简短的可直接采用的行动或结果，选项之间含义明确不同。",
    }),
  },
  { additionalProperties: false },
);

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
    options: Type.Array(QUESTION_OPTION_PARAMETERS, {
      description: "身份唯一、按推荐顺序排列的固定答案。",
      minItems: AGENT_QUESTION_OPTION_MIN,
      maxItems: AGENT_QUESTION_OPTION_MAX,
    }),
  },
  { additionalProperties: false },
);

/** 规范模型生成的可见文本，并保证选项身份在单次问题内唯一。 */
function normalize_question(params: Static<typeof ASK_USER_PARAMETERS>): AgentQuestion {
  const prompt = params.prompt.trim();
  const description = params.description?.trim();
  const option_ids = new Set<string>();
  const options: AgentQuestionOption[] = params.options.map((option) => {
    const id = option.id.trim();
    const label = option.label.trim();
    if (
      id === "" ||
      label === "" ||
      label.length > AGENT_QUESTION_LABEL_LIMIT ||
      option_ids.has(id)
    ) {
      throw new AgentToolError({ code: "invalid_question" });
    }
    option_ids.add(id);
    return { id, label };
  });
  const [first, second, third] = options;
  if (
    prompt === "" ||
    prompt.length > AGENT_QUESTION_PROMPT_LIMIT ||
    first === undefined ||
    second === undefined ||
    (params.description !== undefined &&
      (description === undefined ||
        description === "" ||
        description.length > AGENT_QUESTION_DESCRIPTION_LIMIT))
  ) {
    throw new AgentToolError({ code: "invalid_question" });
  }
  return description === undefined
    ? { prompt, options: third === undefined ? [first, second] : [first, second, third] }
    : {
        prompt,
        description,
        options: third === undefined ? [first, second] : [first, second, third],
      };
}

/** ask_user 把阻塞性决定交给宿主 UI，并将一次性结果返回当前工具轮次。 */
export function create_agent_question_tools(question: AgentQuestionPort): ToolDefinition[] {
  return [
    defineTool({
      name: "ask_user",
      label: "询问用户",
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
        "- 选择预设选项后，按返回的选项标识执行。",
        "- 自定义回答作为新的用户要求处理。",
        "- 用户取消时暂停依赖该决定的动作。等待后续输入。",
      ].join("\n"),
      executionMode: "sequential",
      parameters: ASK_USER_PARAMETERS,
      execute: async (tool_call_id, params, signal) => {
        const result = await question.wait_for_answer(
          tool_call_id,
          normalize_question(params),
          signal,
        );
        return agent_tool_result(result);
      },
    }),
  ];
}
