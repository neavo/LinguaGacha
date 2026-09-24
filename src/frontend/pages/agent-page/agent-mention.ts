import type { AgentSkillSnapshot } from "@shared/agent";
import {
  find_agent_reference_ranges,
  format_agent_reference,
  type AgentFileCandidate,
} from "@shared/agent-reference";
import { create_text_resolver, type Locale } from "@shared/i18n";

const DEFAULT_FILE_CANDIDATE_LIMIT = 3; // 默认展示数量由产品要求确定。
const SEARCH_FILE_CANDIDATE_LIMIT = 20; // 限制搜索菜单规模。

/** 页面提供宿主指令的显示状态与即时动作；它不进入消息协议。 */
export type AgentMentionInstruction = Readonly<{
  id: string;
  title: string;
  description: string;
  disabled: boolean;
  execute: () => void;
}>;

/** 候选只保留渲染与选择所需事实；文件和技能写入正文，指令立即执行宿主动作。 */
export type AgentMentionCandidate = Readonly<
  | {
      kind: "skill" | "file";
      key: string;
      title: string;
      description: string;
      insertText: string;
    }
  | (AgentMentionInstruction & { kind: "instruction"; key: string })
>;

/** 分组保持渲染顺序显式，连续活动索引由 Composer 跨分组统一计算。 */
type AgentMentionCandidateGroups = Readonly<{
  skills: readonly AgentMentionCandidate[];
  instructions: readonly AgentMentionCandidate[];
  files: readonly AgentMentionCandidate[];
}>;

/** 指令文案和可用性由调用方注入，纯投影不依赖 React i18n 或会话状态。 */
type CreateAgentMentionCandidatesArgs = Readonly<{
  query: string;
  locale: Locale;
  skills: readonly AgentSkillSnapshot[];
  instructions: readonly AgentMentionInstruction[];
  files?: readonly AgentFileCandidate[];
}>;

/** 统一投影菜单分组；稳定指令名与本地化标题都可以用于筛选。 */
export function create_agent_mention_candidates(
  args: CreateAgentMentionCandidatesArgs,
): AgentMentionCandidateGroups {
  const t = create_text_resolver(args.locale);
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
      insertText: format_agent_reference({ kind: "skill", name: skill.name }),
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

  const terms = query_text.trim().split(/\s+/u).filter(Boolean);
  const matching_files = (args.files ?? []).filter((file) =>
    terms.every((term) => file.path.toLocaleLowerCase(args.locale).includes(term)),
  );
  // 保留来源顺序，默认精简展示，搜索始终匹配完整列表。
  const file_limit =
    terms.length === 0 ? DEFAULT_FILE_CANDIDATE_LIMIT : SEARCH_FILE_CANDIDATE_LIMIT;
  const files = matching_files.slice(0, file_limit).map((file): AgentMentionCandidate => ({
    kind: "file",
    key: `${file.kind}:${file.path}`,
    title: file.path,
    description:
      file.kind === "workspace"
        ? `${t("agent_page.mention.files.workspace")} · ${t(file.unit === "pages" ? "agent_page.mention.files.pages" : "agent_page.mention.files.items", { COUNT: file.count.toLocaleString(args.locale) })}`
        : `${t("agent_page.mention.files.upload")} · ${format_file_size(file.size)}`,
    insertText: format_agent_reference(file),
  }));
  return { skills, files, instructions };
}

/** 文件大小只用于候选摘要，原始字节数仍由后端持有。 */
function format_file_size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 块状显示只依赖当前可引用技能，失效引用保留原文并恢复普通文本编辑。 */
export function find_agent_mention_ranges(text: string, skills: readonly AgentSkillSnapshot[]) {
  const names = new Set(skills.map((skill) => skill.name));
  return find_agent_reference_ranges(text).filter(
    ({ reference }) => reference.kind !== "skill" || names.has(reference.name),
  );
}
