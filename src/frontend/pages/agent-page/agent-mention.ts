import {
  find_agent_reference_ranges,
  format_agent_skill_reference,
  type AgentReferenceRange,
  type AgentSkillSnapshot,
} from "@shared/agent";
import type { Locale } from "@shared/i18n";

/** 页面提供宿主指令的显示状态与即时动作；它不进入消息协议。 */
export type AgentMentionInstruction = Readonly<{
  id: string;
  title: string;
  description: string;
  disabled: boolean;
  execute: () => void;
}>;

/** 候选只保留渲染与选择所需事实；技能写入正文，指令立即执行宿主动作。 */
export type AgentMentionCandidate = Readonly<
  | {
      kind: "skill";
      key: string;
      title: string;
      description: string;
      insertText: string;
    }
  | (AgentMentionInstruction & { kind: "instruction"; key: string })
>;

/** 分组保持渲染顺序显式，连续活动索引由 Composer 在两组之上统一计算。 */
type AgentMentionCandidateGroups = Readonly<{
  skills: readonly AgentMentionCandidate[];
  instructions: readonly AgentMentionCandidate[];
}>;

/** 指令文案和可用性由调用方注入，纯投影不依赖 React i18n 或会话状态。 */
type CreateAgentMentionCandidatesArgs = Readonly<{
  query: string;
  locale: Locale;
  skills: readonly AgentSkillSnapshot[];
  instructions: readonly AgentMentionInstruction[];
}>;

/** 统一投影菜单分组；稳定指令名与本地化标题都可以用于筛选。 */
export function create_agent_mention_candidates(
  args: CreateAgentMentionCandidatesArgs,
): AgentMentionCandidateGroups {
  const query_text = args.query.toLocaleLowerCase(args.locale);
  const skills = args.skills
    .filter((skill) =>
      `${skill.name}\n${skill.displayDescriptions[args.locale]}`
        .toLocaleLowerCase(args.locale)
        .includes(query_text),
    )
    .map((skill) => ({
      kind: "skill" as const,
      key: `skill:${skill.name}`,
      title: skill.name,
      description: skill.displayDescriptions[args.locale],
      insertText: format_agent_skill_reference(skill.name),
    }));
  const instructions = args.instructions
    .filter((instruction) =>
      `${instruction.id}\n${instruction.title}\n${instruction.description}`
        .toLocaleLowerCase(args.locale)
        .includes(query_text),
    )
    .map((instruction) => ({
      ...instruction,
      kind: "instruction" as const,
      key: `instruction:${instruction.id}`,
    }));

  return { skills, instructions };
}

/** 已知 mention 只提供字面量 marker；显示与消息协议共用同一字符串。 */
export type AgentMentionToken = Readonly<{ marker: string }>;

/** 已知 marker 在正文中的非重叠范围，供编辑器与时间线分别投影。 */
export type AgentMentionRange = AgentReferenceRange;

/** 只有技能会进入正文；动作型指令选择后立即执行，不产生 marker。 */
export function create_agent_mention_tokens(
  skills: readonly AgentSkillSnapshot[],
): AgentMentionToken[] {
  return [...new Set(skills.map((skill) => format_agent_skill_reference(skill.name)))]
    .sort((left, right) => right.length - left.length)
    .map((marker) => ({ marker }));
}

/** 找出正文中的已知 marker；重叠时只保留已排序列表中更长的完整 marker。 */
export function find_agent_mention_ranges(
  text: string,
  tokens: readonly AgentMentionToken[],
): AgentMentionRange[] {
  return find_agent_reference_ranges(
    text,
    tokens.map((token) => token.marker),
  );
}
