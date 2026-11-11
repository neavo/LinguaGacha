import { AGENT_MODEL_USAGES } from "../../../domain/model";
import { AGENT_DOCUMENT_MAX_BYTES } from "../../../shared/agent";
import { Check } from "typebox/value";
import {
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_CHANGE_PATHS,
} from "../workspace/paths";
import type { AgentWorkspaceQualityChangeOperation } from "../workspace/paths";
import { create_schema_renderer } from "../workspace/schema-description";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";

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
} from "../workspace/schema";

/** 磁盘 contract、脚本运行时与模型声明共同消费的外壳 Schema。 */
export const AGENT_WORKSPACE_CONTRACT_SCHEMA = Type.Object(
  {
    datasets: Type.Record(
      Type.String(),
      Type.Object(
        { path: Type.String(), reference: Type.String(), purpose: Type.String() },
        { additionalProperties: false },
      ),
    ),
    changes: Type.Record(
      Type.String(),
      Type.Record(
        Type.String(),
        Type.Object(
          { path: Type.String(), reference: Type.String() },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

/** 脚本通过索引定位数据与变更文件，通过参考资料读取记录约束。 */
export type AgentWorkspaceRuntimeContract = Readonly<
  Static<typeof AGENT_WORKSPACE_CONTRACT_SCHEMA>
>;

/** 参考资料按业务主题聚合，读取与修改共享同一份语义。 */
const reference_path = (topic: string): string => `${AGENT_WORKSPACE_PATHS.reference}/${topic}.md`;
/** 文件与质量规则共用 `insert_by_sort`，批次顺序只维护这一份，取值含义见 `sort` 字段。 */
const sort_notes = [
  "排序时，先移除删除对象和指定了 `sort` 的对象，其余对象保留相对顺序，再按 `sort` 从小到大插入，`-1` 最后追加。",
  "插入位置相同时，先放更新，再放新增，各自按变更文件中的行序排列。",
];
/** 参考资料随工作区提供给模型，说明提交副作用和跨记录关系。 */
const reference_notes: Readonly<Record<string, readonly string[]>> = {
  knowledge: [
    `\`fp\` 从 \`project_meta.json\` 的 \`knowledge\` 复制。\`text\` 是整篇最终正文，UTF-8 编码不超过 ${AGENT_DOCUMENT_MAX_BYTES / 1024 / 1024} MiB。`,
  ],
  function_models: [
    "每次 `workspace_run` 刷新三个用途的非敏感摘要，不可用用途为 `null`。",
    "用途对应 `batch_llm_request` 的 `model_usage`。子模型未单独配置时跟随当前主控模型。后端在工具启动时解析用户的当前选择。",
  ],
  project_meta: [
    `\`files\` 列出全部资产，原稿位于 \`sources/<file_path>\`。\`knowledge\` 是工程知识的指纹，正文位于 \`${AGENT_WORKSPACE_PATHS.knowledge}\`。`,
  ],
  // 文件变更没有同名数据集，规则自成主题，读取元数据时不必加载写入约束。
  files: [
    "同一 `file_path` 在本批只能出现在一条更新或删除记录中，同一 `source_path` 只能新增一次。",
    "新增资产与已有名称冲突时，宿主自动加 `_2`、`_3` 等数字后缀，实际名称以回执为准。",
    "`new_file_path` 不能与本批开始时仍保留的其他资产相同，比较不区分大小写，本批删除的资产会释放名称，因此同批不能交换名称或链式改名。",
    "最终资产集合中，资产路径不能与其他资产互为文件和目录。游戏资产去掉扩展名后的路径也由它独占。",
    "改名保留原扩展名，新路径每段须为跨平台合法文件名。",
    "删除资产会从工程中移除它的原稿、条目、页面和译文。",
    "新资产在其余变化之后按新增记录的顺序追加到末尾。",
    ...sort_notes,
  ],
  items: [
    "`dst` 或 `name_dst` 实际变化时状态默认改为 `PROCESSED`，同值提交不改变状态。",
    '显式 `status` 优先于默认状态，接受现有译文时可只提交 `status: "PROCESSED"`。',
    "同一文件中 `src` 与 `name_src` 相同的条目为同文组，宿主按重复过滤设置自动维护组内的 `NONE` 与 `DUPLICATED`。",
  ],
  pages: [
    "以 `file_path` 和 `page` 定位页面，同批每页只提交一次，各页独立接受或拒绝。",
    "更新完整替换 `translation`、`reviewed` 和 `notes`。",
  ],
  prompts: [],
  ...Object.fromEntries(QUALITY_RULE_KINDS.map((kind) => [kind, sort_notes])),
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
      purpose: `全部 ${kind} 规则，按当前顺序排列`,
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
      AGENT_WORKSPACE_CHANGE_OPERATIONS.map((operation) => [
        operation,
        {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
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
      schema: AGENT_WORKSPACE_PAGE_SCHEMA,
      reference: reference_path("pages"),
      purpose: "全部原稿页面，每行对应一个原稿页",
    },
    function_models: {
      path: AGENT_WORKSPACE_PATHS.functionModels,
      purpose: "主控、翻译与音视频用途的非敏感模型摘要",
      reference: reference_path("function_models"),
      schema: Type.Object(
        Object.fromEntries(
          AGENT_MODEL_USAGES.map((usage) => [
            usage,
            Type.Union([
              Type.Null(),
              Type.Object(
                {
                  name: Type.String(),
                  model_id: Type.String(),
                },
                { additionalProperties: false },
              ),
            ]),
          ]),
        ),
        { additionalProperties: false },
      ),
    },
    project_meta: {
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      purpose: "工程语言、完整数量、文件顺序与知识指纹",
      schema: AGENT_WORKSPACE_PROJECT_META_SCHEMA,
      reference: reference_path("project_meta"),
    },
    items: {
      path: AGENT_WORKSPACE_PATHS.items,
      purpose: "全部翻译条目，正文与姓名属于同一条目",
      schema: AGENT_WORKSPACE_ITEM_SCHEMA,
      reference: reference_path("items"),
    },
    warnings: {
      path: AGENT_WORKSPACE_PATHS.warnings,
      purpose: "当前快照的校对警告与字段级证据，按 `item_id` 关联条目",
      schema: AGENT_WORKSPACE_WARNING_SCHEMA,
      reference: reference_path("items"),
    },
    prompts: {
      path: AGENT_WORKSPACE_PATHS.prompts,
      purpose: "当前翻译提示词",
      schema: AGENT_WORKSPACE_PROMPTS_SCHEMA,
      reference: reference_path("prompts"),
    },
    ...quality_entry_datasets,
  },
  changes: {
    knowledge: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.knowledge.updates,
        schema: AGENT_WORKSPACE_KNOWLEDGE_UPDATE_SCHEMA,
        reference: reference_path("knowledge"),
      },
    },
    files: Object.fromEntries(
      AGENT_WORKSPACE_CHANGE_OPERATIONS.map((operation) => [
        operation,
        {
          path: AGENT_WORKSPACE_CHANGE_PATHS.files[operation],
          schema: AGENT_WORKSPACE_FILE_SCHEMAS[operation],
          reference: reference_path("files"),
        },
      ]),
    ),
    pages: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.pages.updates,
        schema: AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA,
        reference: reference_path("pages"),
      },
    },
    items: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
        schema: AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
        reference: reference_path("items"),
      },
    },
    prompts: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
        schema: AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
        reference: reference_path("prompts"),
      },
    },
    ...quality_changes,
  },
};

/** 索引公开定位信息，参考文档按记录 Schema 展开约束。 */
function project_entries<T extends { schema: TSchema }>(entries: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, { schema: _schema, ...entry }]) => [name, entry]),
  );
}

// 公开类型只暴露索引，避免声明产物携带内部记录 Schema 的 SDK 类型。
export const AGENT_WORKSPACE_CONTRACT: AgentWorkspaceRuntimeContract = Object.freeze({
  datasets: project_entries(definition.datasets),
  changes: Object.fromEntries(
    Object.entries(definition.changes).map(([name, operations]) => [
      name,
      project_entries(operations),
    ]),
  ),
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
          ...records.map(
            (entry) =>
              `- \`${entry.access}.path\`：\`${entry.path}\`，记录类型为 \`${entry.name}\`。`,
          ),
          "",
          "```ts",
          renderer.declarations(),
          "```",
          "",
          ...notes.map((note) => `- ${note}`),
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
    member: [
      "/**",
      " * 提供数据集、变更路径与参考入口。",
      " * 一般先读取目标的 `reference`，了解记录结构、修改格式和副作用。",
      " */",
      "contract: WorkspaceContract;",
    ].join("\n"),
  };
}
/** 输入来自 `structuredClone` 的独立副本，逐层冻结公开对象。 */
function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}
