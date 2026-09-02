import { Type, type TSchema } from "@earendil-works/pi-ai";

import { read_json_integer, type JsonRecord } from "../../../domain/json";
import { PROMPT_KINDS } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  type ProofreadingClientItem,
  type ProofreadingManualStatusCode,
} from "../../../shared/proofreading/proofreading-types";
import {
  AGENT_WORKSPACE_FP_LENGTH,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS,
} from "../../project/agent-workspace-write";

export { AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES } from "./schema";
import {
  AGENT_WORKSPACE_ITEM_SCHEMA,
  AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
  AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  AGENT_WORKSPACE_WARNING_SCHEMA,
  type AgentWorkspaceRuntimeContract,
} from "./schema";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../deno/policy";

export {
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
} from "../../project/agent-workspace-write";

/** 工作区固定只读路径；宿主协议与 Backend 只消费这份布局词表。 */
export const AGENT_WORKSPACE_PATHS = Object.freeze({
  projectMeta: "project_meta.json",
  contract: "contract.json",
  items: "items/entries.jsonl",
  warnings: "items/warnings.jsonl",
  prompts: "prompts.json",
} as const);

/** 对话级任务目录固定名。 */
export const AGENT_WORKSPACE_TASK_ROOT = "task";

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
  items: Object.freeze({ updates: "changes/items/updates.jsonl" }),
  prompts: Object.freeze({ updates: "changes/prompts/updates.jsonl" }),
  ...AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
});

/** item 提交建议只控制上下文与失败恢复成本，不构成后端硬门。 */
const AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS = 100;

const schema_record = (schema: TSchema): JsonRecord => schema as unknown as JsonRecord;

const FP_SCHEMA = Type.String({
  minLength: AGENT_WORKSPACE_FP_LENGTH,
  maxLength: AGENT_WORKSPACE_FP_LENGTH,
  description: "基于对象事实计算的当前快照指纹",
});

const ITEM_SCHEMA = Type.Object(
  { ...AGENT_WORKSPACE_ITEM_SCHEMA.properties, fp: FP_SCHEMA },
  { additionalProperties: false },
);

const ITEM_UPDATE_SCHEMA = Type.Object(
  { ...AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA.properties, fp: FP_SCHEMA },
  { additionalProperties: false },
);

const PROMPTS_SCHEMA = Type.Object(
  Object.fromEntries(
    PROMPT_KINDS.map((kind) => [
      kind,
      Type.Object({ fp: FP_SCHEMA, text: Type.String() }, { additionalProperties: false }),
    ]),
  ),
  { additionalProperties: false },
);

const PROMPT_UPDATE_SCHEMA = Type.Object(
  {
    kind: Type.Union(PROMPT_KINDS.map((kind) => Type.Literal(kind))),
    fp: FP_SCHEMA,
    text: Type.String(),
  },
  { additionalProperties: false },
);

/** project_meta.json 只承载解释快照所需的语言、数量和文件顺序。 */
const PROJECT_META_SCHEMA = Type.Object(
  {
    source_language: Type.String(),
    target_language: Type.String(),
    counts: Type.Object(
      {
        files: Type.Integer({ minimum: 0 }),
        items: Type.Integer({ minimum: 0 }),
        items_with_warnings: Type.Integer({ minimum: 0 }),
        glossary: Type.Integer({ minimum: 0 }),
        text_preserve: Type.Integer({ minimum: 0 }),
        pre_replacement: Type.Integer({ minimum: 0 }),
        post_replacement: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    files: Type.Array(
      Type.Object(
        {
          file_path: Type.String(),
          file_type: Type.String(),
          source_text_path: Type.Optional(Type.String({ description: "普通文本源文件的只读路径" })),
          source_text_root: Type.Optional(
            Type.String({ description: "EPUB 或 XLSX 包内文本树的只读根目录" }),
          ),
        },
        { additionalProperties: false },
      ),
      { description: "按工程文件顺序排列" },
    ),
  },
  { additionalProperties: false },
);

/** quality 字段形状沿用真实领域类型，不建立 Agent 专用别名。 */
const QUALITY_FIELD_SCHEMAS: Record<QualityRuleKind, Record<string, TSchema>> = {
  glossary: {
    src: Type.String(),
    dst: Type.String(),
    info: Type.String(),
    case_sensitive: Type.Boolean(),
  },
  text_preserve: { src: Type.String(), info: Type.String() },
  pre_replacement: {
    src: Type.String(),
    dst: Type.String(),
    regex: Type.Boolean(),
    case_sensitive: Type.Boolean(),
  },
  post_replacement: {
    src: Type.String(),
    dst: Type.String(),
    regex: Type.Boolean(),
    case_sensitive: Type.Boolean(),
  },
};

/** 四类只读 quality 数据集共用路径、身份与标准 JSON Schema。 */
const quality_entry_datasets = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    {
      path: AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind],
      format: "jsonl",
      purpose: `${kind} 规则的完整只读有序集合`,
      identity: ["id"],
      schema: schema_record(
        Type.Object(
          {
            id: Type.String(),
            fp: FP_SCHEMA,
            sort: Type.Integer({ minimum: 0, description: "当前零基数组位置" }),
            ...QUALITY_FIELD_SCHEMAS[kind],
          },
          { additionalProperties: false },
        ),
      ),
    },
  ]),
) as JsonRecord;

/** 在标准对象 Schema 上追加“至少一个可写字段”约束。 */
function require_one_of(schema: TSchema, fields: readonly string[]): JsonRecord {
  return {
    ...schema_record(schema),
    anyOf: fields.map((field) => ({ required: [field] })),
  };
}

/** 从领域字段生成四类显式操作契约，写入格式与模型类型共享同一 Schema。 */
const quality_changes = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => {
    const mutable_fields = Object.fromEntries(
      Object.entries(QUALITY_FIELD_SCHEMAS[kind]).map(([field, schema]) => [
        field,
        Type.Optional(schema),
      ]),
    );
    return [
      kind,
      {
        creates: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].creates,
          format: "jsonl",
          schema: schema_record(
            Type.Object(
              { ...QUALITY_FIELD_SCHEMAS[kind], sort: Type.Integer({ minimum: -1 }) },
              { additionalProperties: false },
            ),
          ),
        },
        updates: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].updates,
          format: "jsonl",
          schema: require_one_of(
            Type.Object(
              {
                id: Type.String(),
                fp: FP_SCHEMA,
                ...mutable_fields,
                sort: Type.Optional(Type.Integer({ minimum: -1 })),
              },
              { additionalProperties: false },
            ),
            [...AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind], "sort"],
          ),
        },
        deletes: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].deletes,
          format: "jsonl",
          schema: schema_record(
            Type.Object({ id: Type.String(), fp: FP_SCHEMA }, { additionalProperties: false }),
          ),
        },
      },
    ];
  }),
) as JsonRecord;

/** 工作区结构、字段、显式 change 与写入语义的唯一代码权威。 */
const agent_workspace_contract = {
  limits: {
    result_bytes: AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes,
    query_page_default: 20,
    query_page_max: 100,
    literal_match_examples_default: 3,
    literal_match_examples_max: AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  },
  datasets: {
    project_meta: {
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      format: "json",
      purpose: "工程语言、完整数量与文件顺序",
      schema: schema_record(PROJECT_META_SCHEMA),
    },
    items: {
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl",
      purpose: "完整只读条目集合",
      identity: ["item_id"],
      schema: schema_record(ITEM_SCHEMA),
    },
    warnings: {
      path: AGENT_WORKSPACE_PATHS.warnings,
      format: "jsonl",
      purpose: "按 item_id 关联的加载时校对警告证据",
      identity: ["item_id"],
      schema: schema_record(AGENT_WORKSPACE_WARNING_SCHEMA),
    },
    prompts: {
      path: AGENT_WORKSPACE_PATHS.prompts,
      format: "json",
      purpose: "两类提示词对象基线与只读正文",
      identity: [...PROMPT_KINDS],
      schema: schema_record(PROMPTS_SCHEMA),
    },
    ...quality_entry_datasets,
  },
  changes: {
    items: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
        format: "jsonl",
        identity: ["item_id"],
        schema: require_one_of(ITEM_UPDATE_SCHEMA, AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS),
      },
    },
    prompts: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
        format: "jsonl",
        identity: ["kind"],
        schema: schema_record(PROMPT_UPDATE_SCHEMA),
      },
    },
    ...quality_changes,
  },
  effects: {
    item_updates: {
      non_empty_dst: { status: "PROCESSED" },
      empty_dst: { status: "preserve" },
      name_dst: { status: "preserve", retry_count: "preserve" },
      explicit_status: { precedence: "after_dst", retry_count: 0 },
    },
  },
  guidance: {
    apply: {
      item_updates: {
        preferred_max_rows: AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS,
        hard_max_rows: null,
      },
      quality_changes: { preferred_max_rows: null, hard_max_rows: null },
    },
  },
  apply: {
    quality_operation_order: [...AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS],
    freshness: "工程身份、语言与 epoch 必须兼容；既有目标的 fp 必须匹配事务内当前对象",
    transaction: "全部实际成功对象在一个数据库事务中提交",
    partial_success: "单行或单对象失败进入 rejected，不阻塞无关对象",
    rejection_reasons: [
      "invalid_change",
      "fp_mismatch",
      "target_missing",
      "merge_conflict",
      "dependency_conflict",
    ],
    result: {
      status: ["applied", "partial", "rejected", "unchanged"],
      fields: ["status", "applied", "rejected", "destroyed", "revisions"],
      destroyed: "真实提交或目标事实漂移后为 true；输入错误、无变化和事务回滚后为 false",
    },
  },
} satisfies AgentWorkspaceRuntimeContract;

export const AGENT_WORKSPACE_CONTRACT: JsonRecord = Object.freeze(
  agent_workspace_contract,
) as JsonRecord;

/** warning 只保存关联身份和判决证据，不复制 item 当前值。 */
export function project_agent_workspace_warning(item: ProofreadingClientItem): JsonRecord {
  return {
    item_id: read_json_integer(item.item_id, 0),
    warnings: [...item.warnings],
    warning_fragments_by_code: Object.fromEntries(
      Object.entries(item.warning_fragments_by_code).map(([code, fragments]) => [
        code,
        [...(fragments ?? [])],
      ]),
    ),
    glossary_applications: item.glossary_applications.map((application) => ({
      ...application,
      fields: application.fields.map((field) => ({ ...field })),
    })),
  } as JsonRecord;
}

/** 工作区主动状态更新只接受校对菜单暴露的人工状态。 */
export function is_agent_workspace_manual_status(
  value: unknown,
): value is ProofreadingManualStatusCode {
  return (PROOFREADING_MANUAL_STATUS_CODES as readonly unknown[]).includes(value);
}
