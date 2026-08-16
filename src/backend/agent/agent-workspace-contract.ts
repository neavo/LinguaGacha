import { Item, ITEM_STATUSES, ITEM_TEXT_TYPES } from "../../domain/item";
import { read_json_integer, type JsonRecord } from "../../domain/json";
import { PROMPT_KINDS } from "../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import {
  AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  AGENT_WORKSPACE_MAX_RESULT_BYTES,
} from "../../shared/backend-runtime";
import { read_optional_item_name_text } from "../../shared/item-name";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_WARNING_CODES,
  type ProofreadingClientItem,
  type ProofreadingManualStatusCode,
} from "../../shared/proofreading/proofreading-types";

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

/** 质量规则的四种显式操作各占一个 JSONL 文件。 */
export const AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS = Object.freeze([
  "creates",
  "updates",
  "deletes",
  "moves",
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

/** 随应用发布且允许模型调用的只读 recipe 白名单。 */
export const AGENT_WORKSPACE_RECIPE_NAMES = Object.freeze([
  "query-items",
  "query-item-contexts",
  "derive-common-literal-roots",
] as const);

/** recipe 名称与工作区只读脚本路径共享同一投影。 */
export const AGENT_WORKSPACE_RECIPE_PATHS = Object.freeze(
  Object.fromEntries(
    AGENT_WORKSPACE_RECIPE_NAMES.map((name) => [name, `recipes/${name}.js`]),
  ) as Record<(typeof AGENT_WORKSPACE_RECIPE_NAMES)[number], string>,
);

/** items/entries.jsonl 的完整固定字段和顺序。 */
export const AGENT_WORKSPACE_ITEM_FIELDS = Object.freeze([
  "item_id",
  "src",
  "dst",
  "name_src",
  "name_dst",
  "file_path",
  "text_type",
  "row_number",
  "status",
  "retry_count",
] as const);

/** item change 只允许这三个既有人工写字段。 */
export const AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS = Object.freeze([
  "dst",
  "name_dst",
  "status",
] as const);

/** item 提交建议只控制上下文与失败恢复成本，不构成后端硬门。 */
const AGENT_WORKSPACE_PREFERRED_ITEM_UPDATE_ROWS = 100;

/** 四类质量规则各自的完整领域字段。 */
export const AGENT_WORKSPACE_QUALITY_FIELDS = Object.freeze({
  glossary: ["id", "src", "dst", "info", "case_sensitive"],
  text_preserve: ["id", "src", "info"],
  pre_replacement: ["id", "src", "dst", "regex", "case_sensitive"],
  post_replacement: ["id", "src", "dst", "regex", "case_sensitive"],
} as const satisfies Record<QualityRuleKind, readonly string[]>);

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
    optional_fields: {
      KANA: { type: "string_array" },
      HANGEUL: { type: "string_array" },
      TEXT_PRESERVE: { type: "string_array" },
    },
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
    id: { type: "string" },
    src: { type: "string" },
    dst: { type: "string" },
    info: { type: "string" },
    case_sensitive: { type: "boolean" },
  },
  text_preserve: {
    id: { type: "string" },
    src: { type: "string" },
    info: { type: "string" },
  },
  pre_replacement: {
    id: { type: "string" },
    src: { type: "string" },
    dst: { type: "string" },
    regex: { type: "boolean" },
    case_sensitive: { type: "boolean" },
  },
  post_replacement: {
    id: { type: "string" },
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
      fields: QUALITY_FIELD_CONTRACT[kind],
    },
  ]),
) as JsonRecord;

/** 从领域字段生成四类显式操作契约，避免手写平行 schema。 */
const quality_changes = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => {
    const mutable_fields = Object.fromEntries(
      Object.entries(QUALITY_FIELD_CONTRACT[kind])
        .filter(([field]) => field !== "id")
        .map(([field, contract]) => [field, { ...(contract as JsonRecord), optional: true }]),
    );
    const create_fields = Object.fromEntries(
      Object.entries(QUALITY_FIELD_CONTRACT[kind]).filter(([field]) => field !== "id"),
    );
    return [
      kind,
      {
        creates: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].creates,
          format: "jsonl",
          fields: { ...create_fields, before_id: { type: "nullable_string", optional: true } },
        },
        updates: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].updates,
          format: "jsonl",
          fields: { id: { type: "string" }, ...mutable_fields },
        },
        deletes: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].deletes,
          format: "jsonl",
          fields: { id: { type: "string" } },
        },
        moves: {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind].moves,
          format: "jsonl",
          fields: { id: { type: "string" }, before_id: { type: "nullable_string" } },
        },
      },
    ];
  }),
) as JsonRecord;

/** 工作区结构、字段、显式 change、写入语义和 recipe 的唯一代码权威。 */
export const AGENT_WORKSPACE_CONTRACT: JsonRecord = Object.freeze({
  limits: {
    result_bytes: AGENT_WORKSPACE_MAX_RESULT_BYTES,
    recipe_page_default: 20,
    recipe_page_max: 100,
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
      purpose: "两类提示词只读正文",
      identity: [...PROMPT_KINDS],
      fields: Object.fromEntries(PROMPT_KINDS.map((kind) => [kind, { type: "string" }])),
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
    freshness: "工程身份、语言、epoch 与全部 section revision 必须仍等于加载快照",
    transaction: "全部真实 change 在一个数据库事务中提交",
  },
  recipes: {
    "query-items": {
      path: AGENT_WORKSPACE_RECIPE_PATHS["query-items"],
      purpose: "筛选目标条目并按需联结警告证据",
      parameters: {
        filters: "可选 item_ids、statuses、file_paths、warning_types",
        search:
          "可选 keywords 与 scope(src、dst、all)；仅用于通用 NFKC 小写 includes 检索，不代表产品正式匹配语义",
        include_warnings: "可选 boolean，默认 false",
        offset: "可选非负整数，默认 0",
        limit: "可选正整数，默认 limits.recipe_page_default 且不超过 limits.recipe_page_max",
      },
      returns: "{ total_item_count, items: object[], next_offset? }",
    },
    "query-item-contexts": {
      path: AGENT_WORKSPACE_RECIPE_PATHS["query-item-contexts"],
      purpose: "读取目标条目在同文件自然顺序中的邻近文本",
      parameters: {
        item_ids: "需要补充邻近文本的正整数数组",
      },
      returns: "{ contexts, items: object[], missing_item_ids }",
    },
    "derive-common-literal-roots": {
      path: AGENT_WORKSPACE_RECIPE_PATHS["derive-common-literal-roots"],
      purpose: "为已经确认语义相关的显式词形枚举全部公共连续字面片段",
      parameters: {
        forms: "至少两个不同的非空字符串；返回的 root 取自第一项的原始写法",
      },
      returns: "{ candidates: Array<{ root, grapheme_length }> }，按 grapheme_length 升序",
    },
  },
});

/** 数据库兼容字段只在 contract 投影边界归一。 */
export function project_agent_workspace_item(item: JsonRecord): JsonRecord {
  return {
    item_id: read_json_integer(item["item_id"] ?? item["id"], 0),
    src: String(item["src"] ?? ""),
    dst: String(item["dst"] ?? ""),
    name_src: read_optional_item_name_text(item["name_src"]) ?? "",
    name_dst: read_optional_item_name_text(item["name_dst"]) ?? "",
    file_path: String(item["file_path"] ?? ""),
    text_type: Item.normalize_text_type(item["text_type"]),
    row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
    status: Item.normalize_status(item["status"]),
    retry_count: read_json_integer(item["retry_count"], 0),
  };
}

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

/** 内部 entry_id 只在工作区边界改名为公开 id。 */
export function project_agent_workspace_quality_entry(
  kind: QualityRuleKind,
  entry: JsonRecord,
): JsonRecord {
  return Object.fromEntries(
    AGENT_WORKSPACE_QUALITY_FIELDS[kind].map((field) => [
      field,
      field === "id" ? String(entry["entry_id"]) : (entry[field] ?? null),
    ]),
  ) as JsonRecord;
}

/** 工作区主动状态更新只接受校对菜单暴露的人工状态。 */
export function is_agent_workspace_manual_status(
  value: unknown,
): value is ProofreadingManualStatusCode {
  return (PROOFREADING_MANUAL_STATUS_CODES as readonly unknown[]).includes(value);
}
