import type { GlossaryEntry } from "@domain/quality";
import {
  find_agent_reference_ranges,
  format_agent_skill_reference,
  format_agent_term_reference,
  type AgentReferenceRange,
  type AgentSkillSnapshot,
} from "@shared/agent";
import type { Locale } from "@shared/i18n";

/** 初始态给技能入口留出空间；用户开始筛选后再放宽到一个可滚动结果窗口。 */
const AGENT_MENTION_INITIAL_TERM_LIMIT = 3;
const AGENT_MENTION_FILTERED_TERM_LIMIT = 20;

/** 菜单候选只保留渲染与插入所需事实，不进入消息协议或共享状态。 */
export type AgentMentionCandidate = Readonly<{
  kind: "skill" | "term";
  key: string;
  title: string;
  description: string;
  insertText: string;
}>;

/** 分组保持渲染顺序显式，连续活动索引由 Composer 在两组之上统一计算。 */
type AgentMentionCandidateGroups = Readonly<{
  skills: readonly AgentMentionCandidate[];
  terms: readonly AgentMentionCandidate[];
}>;

/** 命中次数的本地化留给调用方，纯投影不依赖 React i18n 上下文。 */
type CreateAgentMentionCandidatesArgs = Readonly<{
  query: string;
  locale: Locale;
  skills: readonly AgentSkillSnapshot[];
  terms: readonly GlossaryEntry[];
  term_hit_counts: Readonly<Record<string, number>>;
  format_term_hits: (count: number) => string;
}>;

/** 统一投影菜单分组；空查询是初始状态，非空查询是筛选状态。 */
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
  const term_limit =
    args.query === "" ? AGENT_MENTION_INITIAL_TERM_LIMIT : AGENT_MENTION_FILTERED_TERM_LIMIT;
  const terms = args.terms
    .map((term, index) => ({ term, index }))
    .filter(
      ({ term }) =>
        term.src !== "" &&
        `${term.src}\n${term.dst}\n${term.info}`
          .toLocaleLowerCase(args.locale)
          .includes(query_text),
    )
    .slice(0, term_limit)
    .map(({ term, index }) => ({
      kind: "term" as const,
      key: `term:${index.toString()}:${term.src}`,
      title: term.src,
      description: [
        term.dst,
        term.info,
        term.entry_id !== undefined && Object.hasOwn(args.term_hit_counts, term.entry_id)
          ? args.format_term_hits(args.term_hit_counts[term.entry_id] ?? 0)
          : "",
      ]
        .filter((value) => value !== "")
        .join(" · "),
      insertText: format_agent_term_reference(term.src),
    }));

  return { skills, terms };
}

/** 已知 mention 只提供字面量 marker；显示与消息协议共用同一字符串。 */
export type AgentMentionToken = Readonly<{ marker: string }>;

/** 已知 marker 在正文中的非重叠范围，供编辑器与时间线分别投影。 */
export type AgentMentionRange = AgentReferenceRange;

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
  return find_agent_reference_ranges(
    text,
    tokens.map((token) => token.marker),
  );
}
