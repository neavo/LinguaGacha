import type { LocaleKey, TextResolver } from "@shared/i18n";
import { format_agent_reference } from "@shared/agent-reference";
import type { AgentInputRequest } from "@frontend/app/navigation/types";

type AgentInputStep = Readonly<{ label_key: LocaleKey; skill: string }>;

const TRANSLATION_STEPS = [
  { label_key: "app.agent_input.steps.glossary", skill: "glossary" },
  { label_key: "app.agent_input.steps.translate", skill: "translation" },
  { label_key: "app.agent_input.steps.review", skill: "translation" },
  { label_key: "app.translation_export.action", skill: "project-operation" },
] as const satisfies readonly AgentInputStep[];

/** 多步骤指令按执行顺序编号，每步附上负责该操作的技能。 */
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

/** 拖入素材和侧栏新建共用翻译指令，路径为空时交给编辑器选中占位行。 */
export function format_agent_translation_request(
  t: TextResolver,
  paths: readonly string[],
): AgentInputRequest {
  return format_agent_path_request(
    t,
    t("app.agent_input.import_sources"),
    paths,
    format_agent_input_steps(t, TRANSLATION_STEPS),
  );
}
