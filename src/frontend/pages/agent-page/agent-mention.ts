import type { GlossaryEntry } from "@domain/quality";
import {
  format_agent_skill_reference,
  format_agent_term_reference,
  type AgentSkillSnapshot,
} from "@shared/agent";

/** 已知 mention 只提供字面量 marker；显示与消息协议共用同一字符串。 */
export type AgentMentionToken = Readonly<{ marker: string }>;

/** 已知 marker 在正文中的非重叠范围，供编辑器与时间线分别投影。 */
export type AgentMentionRange = Readonly<{
  from: number;
  to: number;
  marker: string;
}>;

/** 从当前能力与术语生成去重 marker，长 marker 优先解决括号术语的前缀重叠。 */
export function create_agent_mention_tokens(
  skills: readonly AgentSkillSnapshot[],
  terms: readonly GlossaryEntry[],
): AgentMentionToken[] {
  const markers = [
    ...skills.map((skill) => format_agent_skill_reference(skill.name)),
    ...terms.flatMap((term) => (term.src === "" ? [] : [format_agent_term_reference(term.src)])),
  ];
  return [...new Set(markers)]
    .sort((left, right) => right.length - left.length)
    .map((marker) => ({ marker }));
}

/** 找出正文中的已知 marker；重叠时只保留已排序列表中更长的完整 marker。 */
export function find_agent_mention_ranges(
  text: string,
  tokens: readonly AgentMentionToken[],
): AgentMentionRange[] {
  const ranges: AgentMentionRange[] = [];
  // ponytail: 短消息用直接扫描最省结构；真实性能热点出现时再换多模式匹配器。
  for (const token of tokens) {
    let from = text.indexOf(token.marker);
    while (from >= 0) {
      const to = from + token.marker.length;
      if (!ranges.some((range) => from < range.to && to > range.from)) {
        ranges.push({ from, to, marker: token.marker });
      }
      from = text.indexOf(token.marker, to);
    }
  }
  return ranges.sort((left, right) => left.from - right.from);
}
