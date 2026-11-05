import type { LocaleKey, TextResolver } from "@shared/i18n";
import { format_agent_reference } from "@shared/agent-reference";

export type AgentInputStep = Readonly<{ label_key: LocaleKey; skill: string }>;

/** 多步骤预置指令共用前缀与编号格式，技能引用不校验是否存在。 */
export function format_agent_input_steps(
  t: TextResolver,
  steps: readonly AgentInputStep[],
): string {
  const lines = steps.map(
    (step, index) =>
      `${index + 1}. ${t(step.label_key)} ${format_agent_reference({ kind: "skill", name: step.skill })}`,
  );
  return `${t("app.agent_input.steps_intro")}\n${lines.join("\n")}`;
}
