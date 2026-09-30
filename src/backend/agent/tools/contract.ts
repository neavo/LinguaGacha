import { Check } from "typebox/value";
import {
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_CHANGE_PATHS,
} from "../workspace/paths";
import type { AgentWorkspaceQualityChangeOperation } from "../workspace/paths";
import { create_schema_renderer } from "../workspace/schema-description";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";

import { PROMPT_KINDS } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import {
  AGENT_WORKSPACE_FP_SCHEMA,
  AGENT_WORKSPACE_PAGE_SCHEMA,
  AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA,
  AGENT_WORKSPACE_ITEM_SCHEMA,
  AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROMPTS_SCHEMA,
  AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROJECT_META_SCHEMA,
  AGENT_WORKSPACE_QUALITY_SCHEMAS,
  AGENT_WORKSPACE_WARNING_SCHEMA,
} from "../workspace/schema";

/** 磁盘 contract、脚本运行时与模型声明共同消费的外壳 Schema。 */
export const AGENT_WORKSPACE_CONTRACT_SCHEMA = Type.Object(
  {
    datasets: Type.Record(
      Type.String(),
      Type.Object(
        {
          path: Type.String(),
          format: Type.Union([Type.Literal("json"), Type.Literal("jsonl")]),
          reference: Type.String(),
          purpose: Type.Optional(Type.String()),
          identity: Type.Optional(Type.Array(Type.String())),
        },
        { additionalProperties: false },
      ),
    ),
    changes: Type.Record(
      Type.String(),
      Type.Record(
        Type.String(),
        Type.Object(
          {
            path: Type.String(),
            format: Type.Literal("jsonl"),
            reference: Type.String(),
            identity: Type.Optional(Type.Array(Type.String())),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    apply: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false },
);

/** 脚本通过索引定位数据与变更文件，通过参考资料读取记录约束。 */
export type AgentWorkspaceRuntimeContract = Readonly<
  Static<typeof AGENT_WORKSPACE_CONTRACT_SCHEMA>
>;

/** 条目批量建议用于控制上下文与失败恢复成本。 */
const AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS = 100;

/** 参考资料按业务主题聚合，读取与修改共享同一份语义。 */
const reference_path = (topic: string): string => `${AGENT_WORKSPACE_PATHS.reference}/${topic}.md`;
/** 四类质量规则共享排序、冲突与批次语义。 */
const quality_notes = [
  "一次提交会处理完整批次中的 `creates`、`updates` 和 `deletes`。",
  "同一对象的删除已接受时，更新返回 `merge_conflict`。依赖删除的新增或更新，在删除失败时可能返回 `dependency_conflict`。",
  "排序时，先移除删除对象与明确指定 `sort` 的对象，其余对象保留相对顺序。再按非负 `sort` 值从小到大插入对象，将 `sort` 为 `-1` 的对象追加到末尾。",
  "插入位置相同时，先处理更新再处理新增，各自按变更文件中的行序排列。最后按对应领域规则整理结果。",
  "质量规则变更没有建议或强制的单批行数上限。",
];
/** 参考资料随工作区提供给模型，说明提交副作用和跨记录关系。 */
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
/** 按领域类型和操作名关联变更路径与记录约束。 */
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

/** 索引公开定位信息，参考文档按记录 Schema 展开约束。 */
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
      const named_schemas = new Map<TSchema, string>(
        records.map((entry) => [entry.schema, entry.name]),
      );
      // 同一主题多次引用指纹时集中说明，其余主题直接展示字段约束。
      if (
        records.filter(
          (entry) =>
            (entry.schema as { properties?: Record<string, TSchema> }).properties?.fp ===
            AGENT_WORKSPACE_FP_SCHEMA,
        ).length > 1
      ) {
        named_schemas.set(AGENT_WORKSPACE_FP_SCHEMA, "WorkspaceFingerprint");
      }
      const renderer = create_schema_renderer(named_schemas);
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

/** 校验磁盘契约，复制并冻结公开副本，隔离工作区脚本与借入对象。 */
export function create_workspace_contract(contract: unknown): AgentWorkspaceRuntimeContract {
  if (!Check(AGENT_WORKSPACE_CONTRACT_SCHEMA, contract))
    throw new Error("Workspace contract does not match the runtime schema.");
  return deep_freeze(structuredClone(contract));
}
/** 模型类型和属性声明与运行时校验使用同一外壳 Schema。 */
export function describe_workspace_contract() {
  return {
    types: create_schema_renderer(
      new Map([[AGENT_WORKSPACE_CONTRACT_SCHEMA, "WorkspaceContract"]]),
    ).declarations(),
    member: "contract: WorkspaceContract;",
  };
}
/** 输入来自 `structuredClone` 的独立副本，逐层冻结公开对象。 */
function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}
