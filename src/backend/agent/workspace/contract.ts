import { AGENT_DOCUMENT_MAX_BYTES } from "../../../shared/agent";
import { PDF_REGION_SCHEMA } from "../../../shared/pdf-schema";
import {
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_CHANGE_PATHS,
} from "./paths";
import type { AgentWorkspaceQualityChangeOperation } from "./paths";
import { create_schema_renderer } from "./schema-description";
import { Type, type Static, type TSchema } from "typebox";

import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import {
  AGENT_WORKSPACE_KNOWLEDGE_UPDATE_SCHEMA,
  AGENT_WORKSPACE_FILE_SCHEMAS,
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
} from "./schema";

/** 脚本运行时和模型声明共同消费的路径索引 Schema。 */
const workspace_contract_schema = Type.Object(
  {
    datasets: Type.Record(
      Type.String(),
      Type.Object({ path: Type.String() }, { additionalProperties: false }),
    ),
    changes: Type.Record(
      Type.String(),
      Type.Record(
        Type.String(),
        Type.Object({ path: Type.String() }, { additionalProperties: false }),
      ),
    ),
  },
  { additionalProperties: false },
);

export type AgentWorkspaceRuntimeContract = Readonly<Static<typeof workspace_contract_schema>>;

/** 质量规则的新增与更新共用同一排序语义。 */
const quality_sort_notes = [
  "- 排序时，先移除删除对象和指定了 `sort` 的更新对象，其余对象保留相对顺序。",
  "- 再按 `sort` 从小到大插回（`-1` 放末尾），位置相同时先放更新、再放新增，各自按变更行序排列。",
];

/** Schema 无法表达的跨记录关系与提交副作用。 */
const workspace_notes: readonly Readonly<{ title: string; lines: readonly string[] }>[] = [
  {
    title: "工程知识",
    lines: [
      "- `fp` 从 `project_meta.json` 的 `knowledge` 复制。",
      `- \`text\` 是整篇最终正文，UTF-8 编码不超过 ${AGENT_DOCUMENT_MAX_BYTES / 1024 / 1024} MiB。`,
    ],
  },
  {
    title: "工程元数据",
    lines: [
      "- `files` 列出全部资产，原稿位于 `sources/<file_path>`。",
      `- \`knowledge\` 是工程知识的指纹，正文位于 \`${AGENT_WORKSPACE_PATHS.knowledge}\`。`,
    ],
  },
  {
    title: "工程文件",
    lines: [
      "- 同一 `file_path` 本批只能出现在替换、更新或删除之一，同一 `source_path` 只能新增一次。",
      "- 新增资产与已有名称冲突时，宿主自动加 `_2`、`_3` 等数字后缀，实际名称以回执为准。",
      "- 新增资产按新增记录的顺序追加到本批最终列表末尾。",
      "- 整包替换保持目标资产的 `file_path` 与排序位置不变。",
      "- 改名保留原扩展名，新路径每段须为跨平台合法文件名。",
      "- `new_file_path` 不能与本批未删除的保留资产重名（不区分大小写），同批不支持交换名称或链式改名。",
      "- 任一资产路径不能成为另一资产的父目录，游戏资产去掉扩展名后的输出目录同样独占。",
      "- 排序时，先从保留资产中抽出指定了 `sort` 的更新项，其余保留相对顺序，再按 `sort` 从小到大插回（`-1` 放末尾，同位置按更新行序排列）。",
      "- 删除资产会一并移除它的原稿、条目、页面和译文。",
    ],
  },
  {
    title: "翻译条目",
    lines: [
      "- `dst` 或 `name_dst` 实际变化时状态默认改为 `PROCESSED`，同值提交不改变状态。",
      '- 显式 `status` 优先于默认状态，接受现有译文时可只提交 `status: "PROCESSED"`。',
      "- 同一文件中 `src` 与 `name_src` 相同的条目为同文组，宿主按重复过滤设置自动维护组内的 `NONE` 与 `DUPLICATED`。",
    ],
  },
  {
    title: "页面",
    lines: [
      "- 以 `file_path` 和 `page` 定位页面，同批每页只提交一次，各页独立接受或拒绝。",
      "- 更新完整替换 `translation`、`reviewed` 和 `notes`。",
    ],
  },
  {
    title: "质量规则",
    lines: [
      "- `creates` 提供全部业务字段和 `sort`，`updates` 提供至少一个业务字段或 `sort`，`deletes` 只提供 `id` 和 `fp`。",
      ...quality_sort_notes,
    ],
  },
];

type DatasetDefinition = {
  path: string;
  schema: TSchema;
};
type ChangeDefinition = {
  path: string;
  schema: TSchema;
};

/** 按规则类型组合固定路径与对应记录 Schema。 */
const quality_entry_datasets = Object.fromEntries<DatasetDefinition>(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    {
      path: AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind],
      schema: AGENT_WORKSPACE_QUALITY_SCHEMAS[kind].entries,
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
      AGENT_WORKSPACE_CHANGE_OPERATIONS.map((operation) => [
        operation,
        {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
          schema: AGENT_WORKSPACE_QUALITY_SCHEMAS[kind][operation],
        },
      ]),
    ) as Record<AgentWorkspaceQualityChangeOperation, ChangeDefinition>,
  ]),
) as Record<QualityRuleKind, Record<AgentWorkspaceQualityChangeOperation, ChangeDefinition>>;

/** 路径和记录 Schema 在此关联，运行时索引与 system 契约均从这里生成。 */
const definition = {
  datasets: {
    pages: {
      path: AGENT_WORKSPACE_PATHS.pages,
      schema: AGENT_WORKSPACE_PAGE_SCHEMA,
    },
    project_meta: {
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      schema: AGENT_WORKSPACE_PROJECT_META_SCHEMA,
    },
    items: {
      path: AGENT_WORKSPACE_PATHS.items,
      schema: AGENT_WORKSPACE_ITEM_SCHEMA,
    },
    warnings: {
      path: AGENT_WORKSPACE_PATHS.warnings,
      schema: AGENT_WORKSPACE_WARNING_SCHEMA,
    },
    prompts: {
      path: AGENT_WORKSPACE_PATHS.prompts,
      schema: AGENT_WORKSPACE_PROMPTS_SCHEMA,
    },
    ...quality_entry_datasets,
  },
  changes: {
    knowledge: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.knowledge.updates,
        schema: AGENT_WORKSPACE_KNOWLEDGE_UPDATE_SCHEMA,
      },
    },
    files: Object.fromEntries(
      [...AGENT_WORKSPACE_CHANGE_OPERATIONS, "replaces" as const].map((operation) => [
        operation,
        {
          path: AGENT_WORKSPACE_CHANGE_PATHS.files[operation],
          schema: AGENT_WORKSPACE_FILE_SCHEMAS[operation],
        },
      ]),
    ),
    pages: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.pages.updates,
        schema: AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA,
      },
    },
    items: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
        schema: AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
      },
    },
    prompts: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
        schema: AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
      },
    },
    ...quality_changes,
  },
};

/** 运行时只公开路径，记录用途和结构留在 system 契约。 */
function project_paths(
  entries: Record<string, { path: string }>,
): Record<string, { path: string }> {
  return Object.fromEntries(Object.entries(entries).map(([name, { path }]) => [name, { path }]));
}

export const AGENT_WORKSPACE_CONTRACT: AgentWorkspaceRuntimeContract = deep_freeze({
  datasets: project_paths(definition.datasets),
  changes: Object.fromEntries(
    Object.entries(definition.changes).map(([name, operations]) => [
      name,
      project_paths(operations),
    ]),
  ),
});

/** system 常驻契约由运行时 Schema 生成，避免模型为常用结构额外读取磁盘资源。 */
export function format_agent_workspace_contract_prompt(): string {
  const datasets = Object.entries(definition.datasets).map(([name, entry]) => ({
    ...entry,
    name,
    type_name: `Dataset_${name}`,
  }));
  const quality_kinds = new Set<string>(QUALITY_RULE_KINDS);
  const changes = Object.entries(definition.changes).flatMap(([name, operations]) =>
    Object.entries(operations).map(([operation, entry]) => ({
      ...entry,
      name,
      operation,
      type_name: `Change_${name}_${operation}`,
    })),
  );
  const page_update = changes.find(
    (entry) => entry.name === "pages" && entry.operation === "updates",
  )!;
  const page_dataset = datasets.find((entry) => entry.name === "pages")!;
  const page_update_properties = (page_update.schema as { properties: Record<string, TSchema> })
    .properties;
  const page_dataset_properties = (page_dataset.schema as { properties: Record<string, TSchema> })
    .properties;
  const page_update_keys = Object.keys(page_update_properties);
  const page_update_required = new Set(
    (page_update.schema as { required?: string[] }).required ?? [],
  );
  const page_dataset_required = new Set(
    (page_dataset.schema as { required?: string[] }).required ?? [],
  );
  if (
    page_update_keys.some(
      (key) =>
        JSON.stringify(page_update_properties[key]) !==
          JSON.stringify(page_dataset_properties[key]) ||
        page_update_required.has(key) !== page_dataset_required.has(key),
    )
  )
    throw new Error("Workspace page update no longer matches the page dataset.");
  const record_candidates = [
    ...datasets,
    ...changes.filter(
      (entry) => !quality_kinds.has(entry.name) && entry.type_name !== page_update.type_name,
    ),
  ];
  const rendered_records: typeof record_candidates = [];
  const record_aliases: string[] = [];
  const records_by_schema = new Map<string, (typeof record_candidates)[number]>();
  for (const entry of record_candidates) {
    const key = JSON.stringify(entry.schema);
    const known = records_by_schema.get(key);
    if (known === undefined) {
      records_by_schema.set(key, entry);
      rendered_records.push(entry);
    } else record_aliases.push(`type ${entry.type_name} = ${known.type_name};`);
  }
  record_aliases.push(
    `type ${page_update.type_name} = Pick<${page_dataset.type_name}, ${page_update_keys.map((key) => JSON.stringify(key)).join(" | ")}>;`,
  );
  const renderer = create_schema_renderer(
    new Map<TSchema, string>([
      [AGENT_WORKSPACE_FP_SCHEMA, "WorkspaceFingerprint"],
      [AGENT_WORKSPACE_ITEM_SCHEMA.properties.item_id, "ItemId"],
      [AGENT_WORKSPACE_ITEM_SCHEMA.properties.row_number, "NonNegativeInteger"],
      [AGENT_WORKSPACE_PAGE_SCHEMA.properties.page, "PageNumber"],
      [AGENT_WORKSPACE_PAGE_SCHEMA.properties.width, "PositiveNumber"],
      [PDF_REGION_SCHEMA.properties.x, "NonNegativeNumber"],
      [AGENT_WORKSPACE_PAGE_SCHEMA.properties.digest, "Sha256Digest"],
      [AGENT_WORKSPACE_PAGE_SCHEMA.properties.translation, "PageTranslation"],
      [AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA.properties.text, "PromptText"],
      [AGENT_WORKSPACE_FILE_SCHEMAS.deletes.properties.file_path, "FileTarget"],
      [AGENT_WORKSPACE_QUALITY_SCHEMAS.glossary.entries.properties.id, "QualityRuleId"],
      [AGENT_WORKSPACE_QUALITY_SCHEMAS.glossary.entries.properties.sort, "QualityRuleSort"],
      [AGENT_WORKSPACE_QUALITY_SCHEMAS.glossary.creates.properties.sort, "ChangeSort"],
      ...rendered_records.map((entry) => [entry.schema, entry.type_name] as const),
    ]),
    { compact: true },
  );
  const quality_types = [
    `type QualityRuleKind = ${QUALITY_RULE_KINDS.map((kind) => JSON.stringify(kind)).join(" | ")};`,
    "type QualityEntryByKind = Pick<WorkspaceDatasetRecords, QualityRuleKind>;",
    'type QualityCreate<K extends QualityRuleKind> = Omit<QualityEntryByKind[K], "id" | "fp" | "sort"> & { sort: ChangeSort };',
    'type QualityUpdate<K extends QualityRuleKind> = Pick<QualityEntryByKind[K], "id" | "fp"> & Partial<Omit<QualityEntryByKind[K], "id" | "fp" | "sort">> & { sort?: ChangeSort };',
    'type QualityDelete<K extends QualityRuleKind> = Pick<QualityEntryByKind[K], "id" | "fp">;',
    "type QualityChanges<K extends QualityRuleKind> = { creates: QualityCreate<K>; updates: QualityUpdate<K>; deletes: QualityDelete<K> };",
  ];
  const dataset_map = [
    "type WorkspaceDatasetRecords = {",
    ...datasets.map((entry) => `  ${entry.name}: ${entry.type_name};`),
    "};",
  ];
  const change_map = [
    "type WorkspaceChangeRecords = {",
    ...Object.entries(definition.changes).flatMap(([name, operations]) =>
      quality_kinds.has(name)
        ? [`  ${name}: QualityChanges<${JSON.stringify(name)}>;`]
        : [
            `  ${name}: {`,
            ...Object.keys(operations).map(
              (operation) => `    ${operation}: Change_${name}_${operation};`,
            ),
            "  };",
          ],
    ),
    "};",
  ];
  return [
    "<workspace_contract>",
    "工作区脚本通过全局 `ws` 访问工程快照和变更入口：",
    "",
    "- 从 `ws.contract.datasets.<name>.path` 读取数据集；数据集只读。",
    "- 向 `ws.contract.changes.<name>.<operation>.path` 写入 JSONL 变更，再调用 `workspace_apply` 提交。",
    "- `project_meta` 与 `prompts` 数据集是 JSON；其他数据集是每行一条记录的 JSONL。",
    "- `WorkspaceDatasetRecords` 和 `WorkspaceChangeRecords` 给出各入口的记录类型。",
    "",
    "```ts",
    renderer.declarations(),
    "",
    ...record_aliases,
    "",
    ...quality_types,
    "",
    ...dataset_map,
    "",
    ...change_map,
    "```",
    ...workspace_notes.flatMap(({ title, lines }) => ["", `## ${title}`, "", ...lines]),
    "</workspace_contract>",
  ].join("\n");
}

/** 模型工具声明与运行时对象共用路径索引 Schema。 */
export function describe_workspace_contract() {
  return {
    types: create_schema_renderer(
      new Map([[workspace_contract_schema, "WorkspaceContract"]]),
    ).declarations(),
    member: [
      "/**",
      " * 提供数据集与变更路径；记录结构和提交语义见 system 的 `<workspace_contract>`。",
      " */",
      "contract: WorkspaceContract;",
    ].join("\n"),
  };
}

/** 逐层冻结共享常量，防止工作区脚本修改后影响同进程后续读取。 */
function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}
