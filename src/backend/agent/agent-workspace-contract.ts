import { ITEM_STATUSES, ITEM_TEXT_TYPES } from "../../domain/item";
import { read_json_integer, type JsonRecord } from "../../domain/json";
import { PROMPT_KINDS } from "../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import {
  AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  AGENT_WORKSPACE_MAX_RESULT_BYTES,
} from "../../shared/backend-runtime";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_WARNING_FRAGMENT_CODES,
  PROOFREADING_WARNING_CODES,
  type ProofreadingClientItem,
  type ProofreadingManualStatusCode,
} from "../../shared/proofreading/proofreading-types";
import {
  AGENT_WORKSPACE_FP_LENGTH,
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS,
} from "../project/agent-workspace-write";

export {
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
} from "../project/agent-workspace-write";

/** 工作区固定只读路径；宿主协议与 Backend 只消费这份布局词表。 */
export const AGENT_WORKSPACE_PATHS = Object.freeze({
  projectMeta: "project_meta.json",
  contract: "contract.json",
  items: "items/entries.jsonl",
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
  items: Object.freeze({ updates: "changes/items/updates.jsonl" }),
  prompts: Object.freeze({ updates: "changes/prompts/updates.jsonl" }),
  ...AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
});

/** item 提交建议只控制上下文与失败恢复成本，不构成后端硬门。 */
const AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS = 100;

/** 工作区对象与对应 change 共享同一事实指纹格式。 */
const FP_FIELD_CONTRACT: JsonRecord = Object.freeze({
  type: "string",
  length: AGENT_WORKSPACE_FP_LENGTH,
});

/** 只读数据集在共享格式上补充 fp 的提交用途。 */
const FP_DATASET_FIELD_CONTRACT: JsonRecord = Object.freeze({
  ...FP_FIELD_CONTRACT,
  purpose:
    "基于数据对象事实计算的指纹；用于 workspace_apply 时校验该对象自工作区快照后是否仍保持一致",
});

/** project_meta.json 只承载解释快照所需的语言、数量和文件顺序。 */
const PROJECT_META_FIELD_CONTRACT: JsonRecord = {
  source_language: { type: "string" },
  target_language: { type: "string" },
  counts: {
    type: "object",
    fields: {
      files: { type: "non_negative_integer" },
      items: { type: "non_negative_integer" },
      items_with_warnings: { type: "non_negative_integer" },
      glossary: { type: "non_negative_integer" },
      text_preserve: { type: "non_negative_integer" },
      pre_replacement: { type: "non_negative_integer" },
      post_replacement: { type: "non_negative_integer" },
    },
  },
  files: {
    type: "array",
    order: "工程文件顺序",
    items: {
      type: "object",
      fields: {
        file_path: { type: "string" },
        file_type: { type: "string" },
        source_text_path: {
          type: "string",
          optional: true,
          purpose: "普通文本源文件的只读路径",
        },
        source_text_root: {
          type: "string",
          optional: true,
          purpose: "EPUB 或 XLSX 包内文本树的只读根目录",
        },
      },
    },
  },
};

/** items 只读数据集的完整字段契约。 */
const ITEM_FIELD_CONTRACT: JsonRecord = {
  item_id: { type: "positive_integer", purpose: "稳定条目身份" },
  fp: FP_DATASET_FIELD_CONTRACT,
  src: { type: "string", purpose: "原文正文" },
  dst: { type: "string", purpose: "译文正文" },
  name_src: { type: "string", purpose: "原文姓名" },
  name_dst: { type: "string", purpose: "译文姓名" },
  file_path: { type: "string", purpose: "工程相对文件身份" },
  text_type: {
    type: "enum",
    purpose: "文本的实际类型；用于按格式解释规则命中分布",
    values: [...ITEM_TEXT_TYPES],
  },
  row_number: { type: "non_negative_integer", purpose: "从 0 开始的文件内定位" },
  status: {
    type: "enum",
    purpose: "条目状态；主动修改只接受人工状态",
    values: [...ITEM_STATUSES],
  },
  retry_count: { type: "non_negative_integer", purpose: "重试事实" },
};

/** item update change 的稳定身份与三个可选人工字段。 */
const ITEM_UPDATE_FIELD_CONTRACT: JsonRecord = {
  item_id: { type: "positive_integer" },
  fp: FP_FIELD_CONTRACT,
  dst: { type: "string", optional: true },
  name_dst: { type: "string", optional: true },
  status: {
    type: "enum",
    values: [...PROOFREADING_MANUAL_STATUS_CODES],
    optional: true,
  },
};

/** warning 只保存判决证据和 item 关联身份。 */
const WARNING_FIELD_CONTRACT: JsonRecord = {
  item_id: { type: "positive_integer", purpose: "关联 items 的稳定身份" },
  warnings: { type: "enum_array", values: [...PROOFREADING_WARNING_CODES] },
  warning_fragments_by_code: {
    type: "object",
    optional_fields: Object.fromEntries(
      PROOFREADING_WARNING_FRAGMENT_CODES.map((code) => [code, { type: "string_array" }]),
    ),
  },
  glossary_applications: {
    type: "array",
    items: {
      type: "object",
      fields: {
        entry_id: { type: "string" },
        src: { type: "string" },
        dst: { type: "string" },
        case_sensitive: { type: "boolean" },
        fields: {
          type: "array",
          items: {
            type: "object",
            fields: {
              source_field: { type: "enum", values: ["src", "name_src"] },
              target_field: { type: "enum", values: ["dst", "name_dst"] },
              applied: { type: "boolean" },
            },
          },
        },
      },
    },
  },
};

/** quality 字段形状沿用真实领域类型，不建立 Agent 专用别名。 */
const QUALITY_FIELD_CONTRACT: Record<QualityRuleKind, JsonRecord> = {
  glossary: {
    src: { type: "string" },
    dst: { type: "string" },
    info: { type: "string" },
    case_sensitive: { type: "boolean" },
  },
  text_preserve: {
    src: { type: "string" },
    info: { type: "string" },
  },
  pre_replacement: {
    src: { type: "string" },
    dst: { type: "string" },
    regex: { type: "boolean" },
    case_sensitive: { type: "boolean" },
  },
  post_replacement: {
    src: { type: "string" },
    dst: { type: "string" },
    regex: { type: "boolean" },
    case_sensitive: { type: "boolean" },
  },
};

/** 四类只读 quality 数据集共用路径、身份与字段投影。 */
const quality_entry_datasets = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    {
      path: AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind],
      format: "jsonl",
      purpose: `${kind} 规则的完整只读有序集合`,
      identity: ["id"],
      fields: {
        id: { type: "string" },
        fp: FP_DATASET_FIELD_CONTRACT,
        sort: { type: "integer", minimum: 0, purpose: "当前零基数组位置" },
        ...QUALITY_FIELD_CONTRACT[kind],
      },
    },
  ]),
) as JsonRecord;

/** 从领域字段生成四类显式操作契约，避免手写平行 schema。 */
const quality_changes = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => {
    const mutable_fields = Object.fromEntries(
      Object.entries(QUALITY_FIELD_CONTRACT[kind]).map(([field, contract]) => [
        field,
        { ...(contract as JsonRecord), optional: true },
      ]),
    );
    return [
      kind,
      {
        creates: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].creates,
          format: "jsonl",
          fields: {
            ...QUALITY_FIELD_CONTRACT[kind],
            sort: { type: "integer", minimum: -1 },
          },
        },
        updates: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].updates,
          format: "jsonl",
          fields: {
            id: { type: "string" },
            fp: FP_FIELD_CONTRACT,
            ...mutable_fields,
            sort: { type: "integer", minimum: -1, optional: true },
          },
          require_one_of: [...AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind], "sort"],
        },
        deletes: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].deletes,
          format: "jsonl",
          fields: { id: { type: "string" }, fp: FP_FIELD_CONTRACT },
        },
      },
    ];
  }),
) as JsonRecord;

/** 工作区结构、字段、显式 change 与写入语义的唯一代码权威。 */
export const AGENT_WORKSPACE_CONTRACT: JsonRecord = Object.freeze({
  limits: {
    result_bytes: AGENT_WORKSPACE_MAX_RESULT_BYTES,
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
      fields: PROJECT_META_FIELD_CONTRACT,
    },
    items: {
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl",
      purpose: "完整只读条目集合",
      identity: ["item_id"],
      fields: Object.fromEntries(
        AGENT_WORKSPACE_ITEM_FIELDS.map((field) => [field, ITEM_FIELD_CONTRACT[field]]),
      ),
    },
    warnings: {
      path: AGENT_WORKSPACE_PATHS.warnings,
      format: "jsonl",
      purpose: "按 item_id 关联的加载时校对警告证据",
      identity: ["item_id"],
      fields: WARNING_FIELD_CONTRACT,
    },
    prompts: {
      path: AGENT_WORKSPACE_PATHS.prompts,
      format: "json",
      purpose: "两类提示词对象基线与只读正文",
      identity: [...PROMPT_KINDS],
      fields: Object.fromEntries(
        PROMPT_KINDS.map((kind) => [
          kind,
          {
            type: "object",
            fields: { fp: FP_FIELD_CONTRACT, text: { type: "string" } },
          },
        ]),
      ),
    },
    ...quality_entry_datasets,
  },
  changes: {
    items: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
        format: "jsonl",
        identity: ["item_id"],
        fields: ITEM_UPDATE_FIELD_CONTRACT,
        require_one_of: [...AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS],
      },
    },
    prompts: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
        format: "jsonl",
        identity: ["kind"],
        fields: {
          kind: { type: "enum", values: [...PROMPT_KINDS] },
          fp: FP_FIELD_CONTRACT,
          text: { type: "string" },
        },
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
});

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
