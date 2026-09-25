import { create_schema_renderer } from "./schema-description";
import type { TSchema } from "@earendil-works/pi-ai";

import { read_json_integer } from "../../../domain/json";
import { PROMPT_KINDS } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import type { ProofreadingClientItem } from "../../../shared/proofreading/proofreading-types";
import {
  AGENT_WORKSPACE_PAGE_SCHEMA,
  AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA,
  AGENT_WORKSPACE_ITEM_SCHEMA,
  AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROMPTS_SCHEMA,
  AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROJECT_META_SCHEMA,
  AGENT_WORKSPACE_QUALITY_SCHEMAS,
  AGENT_WORKSPACE_WARNING_SCHEMA,
  type AgentWorkspaceRuntimeContract,
  type AgentWorkspaceWarning,
} from "./schema";

/** 工作区固定只读路径；宿主协议与 Backend 只消费这份布局词表。 */
export const AGENT_WORKSPACE_PATHS = Object.freeze({
  projectMeta: "project_meta.json",
  contract: "contract.json",
  reference: "reference",
  items: "items/entries.jsonl",
  pages: "pages/entries.jsonl",
  warnings: "items/warnings.jsonl",
  prompts: "prompts.json",
} as const);

/** 四类质量规则直接按领域 kind 落盘。 */
export const AGENT_WORKSPACE_QUALITY_ENTRY_PATHS = Object.freeze(
  Object.fromEntries(QUALITY_RULE_KINDS.map((kind) => [kind, `${kind}/entries.jsonl`])) as Record<
    QualityRuleKind,
    string
  >,
);

/** 质量规则的三种对象操作各占一个 JSONL 文件。 */
export const AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS = Object.freeze([
  "creates",
  "updates",
  "deletes",
] as const);

/** 固定 quality change 文件允许的操作名。 */
export type AgentWorkspaceQualityChangeOperation =
  (typeof AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS)[number];

/** 每个 quality kind 复用同一 changes/<kind>/<operation>.jsonl 布局。 */
export const AGENT_WORKSPACE_QUALITY_CHANGE_PATHS = Object.freeze(
  Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => [
      kind,
      Object.freeze(
        Object.fromEntries(
          AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map((operation) => [
            operation,
            `changes/${kind}/${operation}.jsonl`,
          ]),
        ) as Record<AgentWorkspaceQualityChangeOperation, string>,
      ),
    ]),
  ) as Record<QualityRuleKind, Readonly<Record<AgentWorkspaceQualityChangeOperation, string>>>,
);

/** 模型可写的全部固定 change 路径；datasets 本身始终只读。 */
export const AGENT_WORKSPACE_CHANGE_PATHS = Object.freeze({
  pages: Object.freeze({ updates: "changes/pages/updates.jsonl" }),
  items: Object.freeze({ updates: "changes/items/updates.jsonl" }),
  prompts: Object.freeze({ updates: "changes/prompts/updates.jsonl" }),
  ...AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
});

/** item 提交建议只控制上下文与失败恢复成本，不构成后端硬门。 */
const AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS = 100;

/** 参考资料按业务主题聚合，读取与修改共享同一份语义。 */
const reference_path = (topic: string): string => `${AGENT_WORKSPACE_PATHS.reference}/${topic}.md`;
const quality_notes = [
  "一次提交会处理完整批次中的 `creates`、`updates` 和 `deletes`。",
  "同一对象的删除已接受时，更新返回 `merge_conflict`。依赖删除的新增或更新，在删除失败时可能返回 `dependency_conflict`。",
  "排序时，先移除删除对象与明确指定 `sort` 的对象，其余对象保留相对顺序。再按非负 `sort` 值从小到大插入对象，将 `sort` 为 `-1` 的对象追加到末尾。",
  "插入位置相同时，先处理更新再处理新增，各自按变更文件中的行序排列。最后按对应领域规则整理结果。",
  "质量规则变更没有建议或强制的单批行数上限。",
];
const reference_notes: Readonly<Record<string, readonly string[]>> = {
  project_meta: ["工程元数据描述当前快照的语言、完整数量和文件顺序。"],
  items: [
    "`warnings` 按 `item_id` 关联条目，保存快照加载时的校对证据。正文与姓名属于同一个条目。",
    "更新只提交需要变化的字段，省略字段保持当前值。修改 `dst`，或提交失败条目当前已有的非空译文以确认接受时，状态设为 `PROCESSED`，`retry_count` 清零。",
    "单独修改 `name_dst` 保留当前状态和重试计数。显式 `status` 在译文副作用之后生效，并将 `retry_count` 清零。",
    "同文组按 `file_path` 与 `src` 关联，`NONE` 与 `DUPLICATED` 状态由宿主按重复过滤规则自动处理。",
    `建议每批条目更新不超过 ${AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS} 行，以控制上下文与失败恢复成本。这是建议，没有强制行数上限。`,
  ],
  pages: [
    "页面身份由 `file_path` 与从 1 开始的原稿 `page` 组成，`fp` 从当前快照复制。",
    "页面更新完整替换可修改内容。同批同页提交一次，页面独立接受或拒绝，回执按文件与原页码定位，实际更新按页面计数。",
  ],
  prompts: ["以 `kind` 定位提示词，携带当前 `fp` 和完整最终 `text` 提交。"],
  ...Object.fromEntries(QUALITY_RULE_KINDS.map((kind) => [kind, quality_notes])),
};

type DatasetDefinition = AgentWorkspaceRuntimeContract["datasets"][string] & { schema: TSchema };
type ChangeDefinition = AgentWorkspaceRuntimeContract["changes"][string][string] & {
  schema: TSchema;
};

/** 按规则类型组合固定路径与对应记录 Schema。 */
const quality_entry_datasets = Object.fromEntries<DatasetDefinition>(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    {
      path: AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind],
      format: "jsonl" as const,
      purpose: `完整的 ${kind} 规则集合，按当前顺序排列，只读`,
      identity: ["id"],
      schema: AGENT_WORKSPACE_QUALITY_SCHEMAS[kind].entries,
      reference: reference_path(kind),
    },
  ]),
) as Record<QualityRuleKind, DatasetDefinition>;
const quality_changes = Object.fromEntries<
  Record<AgentWorkspaceQualityChangeOperation, ChangeDefinition>
>(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    Object.fromEntries<ChangeDefinition>(
      AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map((operation) => [
        operation,
        {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
          format: "jsonl" as const,
          schema: AGENT_WORKSPACE_QUALITY_SCHEMAS[kind][operation],
          reference: reference_path(kind),
        },
      ]),
    ) as Record<AgentWorkspaceQualityChangeOperation, ChangeDefinition>,
  ]),
) as Record<QualityRuleKind, Record<AgentWorkspaceQualityChangeOperation, ChangeDefinition>>;

/** 路径、记录 Schema 与参考入口在此关联，公开索引和参考正文均从此生成。 */
const definition = {
  datasets: {
    pages: {
      path: AGENT_WORKSPACE_PATHS.pages,
      format: "jsonl" as const,
      schema: AGENT_WORKSPACE_PAGE_SCHEMA,
      reference: reference_path("pages"),
      purpose:
        "完整的 `pages` 集合，只读。每个 `page` 对应一个原稿页，通过 `changes.pages.updates` 完整替换其可修改内容",
      identity: ["file_path", "page"],
    },
    project_meta: {
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      format: "json" as const,
      purpose: "工程语言、完整数量与文件顺序",
      schema: AGENT_WORKSPACE_PROJECT_META_SCHEMA,
      reference: reference_path("project_meta"),
    },
    items: {
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl" as const,
      purpose: "完整的 `items` 集合，只读。正文与姓名属于同一个 `item`",
      identity: ["item_id"],
      schema: AGENT_WORKSPACE_ITEM_SCHEMA,
      reference: reference_path("items"),
    },
    warnings: {
      path: AGENT_WORKSPACE_PATHS.warnings,
      format: "jsonl" as const,
      purpose: "当前快照的校对警告与字段级证据，按 `item_id` 关联条目",
      identity: ["item_id"],
      schema: AGENT_WORKSPACE_WARNING_SCHEMA,
      reference: reference_path("items"),
    },
    prompts: {
      path: AGENT_WORKSPACE_PATHS.prompts,
      format: "json" as const,
      purpose: "当前翻译提示词及其指纹，只读",
      identity: [...PROMPT_KINDS],
      schema: AGENT_WORKSPACE_PROMPTS_SCHEMA,
      reference: reference_path("prompts"),
    },
    ...quality_entry_datasets,
  },
  changes: {
    pages: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.pages.updates,
        format: "jsonl" as const,
        schema: AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA,
        reference: reference_path("pages"),
        identity: ["file_path", "page"],
      },
    },
    items: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
        format: "jsonl" as const,
        identity: ["item_id"],
        schema: AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
        reference: reference_path("items"),
      },
    },
    prompts: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
        format: "jsonl" as const,
        identity: ["kind"],
        schema: AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
        reference: reference_path("prompts"),
      },
    },
    ...quality_changes,
  },
};

/** 通用提交语义也供工具说明读取，保留字段类型且不携带记录 Schema 的 SDK 类型。 */
const apply_contract = {
  freshness: "提交时检查工程身份、语言与 `epoch` 是否兼容，并用 `fp` 核对事务内的当前对象",
  transaction: "已接受的修改在同一事务中提交。事务失败时全部回滚",
  partial_success: "在 `rejected` 中记录被拒绝行或对象的原因，继续提交无关对象",
  rejection_reasons: [
    "invalid_change",
    "fp_mismatch",
    "target_missing",
    "merge_conflict",
    "dependency_conflict",
  ],
  result: {
    status: {
      applied: "有实际变化且无拒绝",
      partial: "有实际变化且有拒绝",
      rejected: "无实际变化且有拒绝",
      unchanged: "无实际变化且无拒绝",
    },
    fields: ["status", "applied", "rejected", "destroyed", "revisions"],
    destroyed:
      "实际提交或发现目标事实已变化后为 `true`，此时数据快照与当前变更清单已销毁，与当前工程相容的 `work/**` 仍保留。输入错误、无变化或事务回滚后为 `false`",
  },
};

/** 索引只公开定位信息；记录约束由参考文档按原 Schema 展开。 */
function project_entries<T extends { schema: TSchema }>(entries: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, { schema: _schema, ...entry }]) => [name, entry]),
  );
}

// 公开类型只暴露索引，避免声明产物携带内部记录 Schema 的 SDK 类型。
export const AGENT_WORKSPACE_CONTRACT: AgentWorkspaceRuntimeContract & {
  readonly apply: typeof apply_contract;
} = Object.freeze({
  datasets: project_entries(definition.datasets),
  changes: Object.fromEntries(
    Object.entries(definition.changes).map(([name, operations]) => [
      name,
      project_entries(operations),
    ]),
  ),
  apply: apply_contract,
});

// 只展开一次全部入口，各主题从同一集合选择自己的读取与修改结构。
const reference_records = [
  ...Object.entries(definition.datasets).map(([name, entry]) => ({
    ...entry,
    name: `Dataset_${name}`,
    access: `ws.contract.datasets.${name}`,
  })),
  ...Object.entries(definition.changes).flatMap(([name, operations]) =>
    Object.entries(operations).map(([operation, entry]) => ({
      ...entry,
      name: `Change_${name}_${operation}`,
      access: `ws.contract.changes.${name}.${operation}`,
    })),
  ),
];

/** 每个主题包含相关读取结构、变更结构与副作用，模型一次读取即可了解对象契约。 */
export const AGENT_WORKSPACE_REFERENCES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(reference_notes).map(([topic, notes]) => {
      const reference = reference_path(topic);
      const records = reference_records.filter((entry) => entry.reference === reference);
      const renderer = create_schema_renderer(
        new Map(records.map((entry) => [entry.schema, entry.name])),
      );
      return [
        reference,
        [
          `# ${topic} 工作区参考`,
          "",
          "路径相对于工作区根目录。以下 TypeScript 声明用于阅读，工作区脚本使用 JavaScript。字段注释中的约束同样适用。",
          "",
          ...records.map(
            (entry) =>
              `- \`${entry.access}.path\`：\`${entry.path}\`，格式为 \`${entry.format}\`，记录类型为 \`${entry.name}\`。`,
          ),
          "",
          "```ts",
          renderer.declarations(),
          "```",
          "",
          ...notes.map((note) => `- ${note}`),
          "",
          "提交前同时读取 `ws.contract.apply` 中的通用提交规则与回执说明。",
          "",
        ].join("\n"),
      ];
    }),
  ),
);

/** 按工作区 Schema 输出条目身份和校对证据，复制嵌套数组以隔离调用方。 */
export function project_agent_workspace_warning(
  item: ProofreadingClientItem,
): AgentWorkspaceWarning {
  return structuredClone({
    item_id: read_json_integer(item.item_id, 0),
    warnings: item.warnings,
    glossary_applications: item.glossary_applications,
  });
}
