import type { LucideIcon } from "lucide-react";
import type { AgentSkillSnapshot } from "@shared/agent";
import { format_agent_reference, type AgentFileCandidate } from "@shared/agent-reference";
import { create_text_resolver } from "@shared/i18n";
import { type Locale } from "@domain/app-language";

const DEFAULT_FILE_CANDIDATE_LIMIT = 3; // 默认展示数量由产品要求确定。
const SEARCH_FILE_CANDIDATE_LIMIT = 20; // 限制搜索菜单规模。

/** 页面提供宿主指令的状态与即时动作。指令不进入消息协议。 */
export type AgentMentionInstruction = Readonly<{
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  disabled: boolean;
  execute: () => void;
}>;

/** 文件和技能候选提供正文引用。指令候选提供宿主动作。 */
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

/** 候选按用途分组，显示顺序与活动索引由编辑器统一维护。 */
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

/** 按查询生成候选分组。指令同时支持稳定名称和本地化文案。 */
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
  const searching_files = terms.length > 0;
  const matching_files = (args.files ?? []).filter((file) =>
    searching_files
      ? terms.every((term) => file.path.toLocaleLowerCase(args.locale).includes(term))
      : file.kind === "workspace",
  );
  const file_limit = searching_files ? SEARCH_FILE_CANDIDATE_LIMIT : DEFAULT_FILE_CANDIDATE_LIMIT;
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
  return { skills, instructions, files };
}

/** 文件大小只用于候选摘要，原始字节数仍由后端持有。 */
function format_file_size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
