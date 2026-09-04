import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  AGENT_QUESTION_OPTION_MAX,
  AGENT_QUESTION_OPTION_MIN,
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
    id: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const ASK_USER_PARAMETERS = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ minLength: 1 })),
    options: Type.Array(QUESTION_OPTION_PARAMETERS, {
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
    if (id === "" || label === "" || option_ids.has(id)) {
      throw new AgentToolError({ code: "invalid_question" });
    }
    option_ids.add(id);
    return { id, label };
  });
  const [first, second, third] = options;
  if (
    prompt === "" ||
    first === undefined ||
    second === undefined ||
    (params.description !== undefined && description === "")
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
      description:
        "正在执行的任务需要一个有界决定时提出一个完整问题。description 可统一说明背景或判断标准；提供二至三个按推荐顺序排列、点击即可采用的固定答案，界面另提供简短自定义答案和取消。五分钟内未回答会结束当前决定。",
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
