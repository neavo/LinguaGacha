import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import { PROJECT_KNOWLEDGE_DOCUMENT } from "../../../shared/project-knowledge";

/** 工作区快照与模型契约共同使用的固定路径。 */
export const AGENT_WORKSPACE_PATHS = Object.freeze({
  knowledge: PROJECT_KNOWLEDGE_DOCUMENT,
  projectMeta: "project_meta.json",
  functionModels: "function_models.json",
  contract: "contract.json",
  reference: "reference",
  items: "items/entries.jsonl",
  pages: "pages/entries.jsonl",
  warnings: "items/warnings.jsonl",
  prompts: "prompts.json",
  sourceIssues: "source_issues.jsonl", // 宿主维护的当前原稿准备问题，与 sources 同寿命。
} as const);

/** 四类质量规则直接按领域 kind 落盘。 */
export const AGENT_WORKSPACE_QUALITY_ENTRY_PATHS = Object.freeze(
  Object.fromEntries(QUALITY_RULE_KINDS.map((kind) => [kind, `${kind}/entries.jsonl`])) as Record<
    QualityRuleKind,
    string
  >,
);

/** 文件与质量规则共用三种变更操作。 */
export const AGENT_WORKSPACE_CHANGE_OPERATIONS = Object.freeze([
  "creates",
  "updates",
  "deletes",
] as const);

/** 固定 quality change 文件允许的操作名。 */
export type AgentWorkspaceQualityChangeOperation =
  (typeof AGENT_WORKSPACE_CHANGE_OPERATIONS)[number];

/** 每个 quality kind 复用同一 changes/<kind>/<operation>.jsonl 布局。 */
export const AGENT_WORKSPACE_QUALITY_CHANGE_PATHS = Object.freeze(
  Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => [
      kind,
      Object.freeze(
        Object.fromEntries(
          AGENT_WORKSPACE_CHANGE_OPERATIONS.map((operation) => [
            operation,
            `changes/${kind}/${operation}.jsonl`,
          ]),
        ) as Record<AgentWorkspaceQualityChangeOperation, string>,
      ),
    ]),
  ) as Record<QualityRuleKind, Readonly<Record<AgentWorkspaceQualityChangeOperation, string>>>,
);

/** 模型只向固定 change 路径写入意图，datasets 始终只读。 */
export const AGENT_WORKSPACE_CHANGE_PATHS = Object.freeze({
  knowledge: Object.freeze({ updates: "changes/knowledge/updates.jsonl" }),
  files: Object.freeze({
    creates: "changes/files/creates.jsonl",
    updates: "changes/files/updates.jsonl",
    deletes: "changes/files/deletes.jsonl",
  }),
  pages: Object.freeze({ updates: "changes/pages/updates.jsonl" }),
  items: Object.freeze({ updates: "changes/items/updates.jsonl" }),
  prompts: Object.freeze({ updates: "changes/prompts/updates.jsonl" }),
  ...AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
});
