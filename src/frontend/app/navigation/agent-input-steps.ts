import type { LocaleKey, TextResolver } from "@shared/i18n";
import { format_agent_reference } from "@shared/agent-reference";
import type { AgentInputRequest } from "@frontend/app/navigation/types";

export type AgentInputStep = Readonly<{ label_key: LocaleKey; skill: string }>;

/**
 * 多步骤预置指令共用前缀与编号格式，技能引用不校验是否存在。
 * 同一份预设在步骤前已有其他任务指令时由调用方声明，引导语改为承接式整句以保持各语言语序。
 */
export function format_agent_input_steps(
  t: TextResolver,
  steps: readonly AgentInputStep[],
  has_prior_instruction = false,
): string {
  const lines = steps.map(
    (step, index) =>
      `${index + 1}. ${t(step.label_key)} ${format_agent_reference({ kind: "skill", name: step.skill })}`,
  );
  const intro = has_prior_instruction
    ? "app.agent_input.steps_intro_after_instruction"
    : "app.agent_input.steps_intro";
  return `${t(intro)}\n${lines.join("\n")}`;
}

/** 提示行后接路径行，没有路径时选中占位行，供用户输入或拖入文件替换。 */
export function format_agent_path_request(
  t: TextResolver,
  prompt: string,
  paths: readonly string[],
  suffix = "",
): AgentInputRequest {
  const placeholder = t("app.agent_input.path_placeholder");
  return {
    text: `${prompt}\n${paths.join("\n") || placeholder}${suffix ? `\n\n${suffix}` : ""}`,
    ...(paths.length === 0 && {
      selection: { from: prompt.length + 1, to: prompt.length + 1 + placeholder.length },
    }),
  };
}
