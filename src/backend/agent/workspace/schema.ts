import {
  PDF_DOCUMENT_SCHEMA,
  PDF_PAGE_SCHEMA,
  PDF_PAGE_UPDATE_SCHEMA,
} from "../../file/formats/pdf/pdf-source";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";

import { ITEM_MANUAL_STATUSES, ITEM_STATUSES, ITEM_TEXT_TYPES } from "../../../domain/item";

import { PROMPT_KINDS } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import {
  AGENT_WORKSPACE_FP_LENGTH,
  AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS,
} from "../../../shared/project/agent-workspace";

const open_record_schema = Type.Object({}, { additionalProperties: true });

export const AGENT_WORKSPACE_DATASET_CONTRACT_SCHEMA = Type.Object(
  {
    path: Type.String(),
    format: Type.Union([Type.Literal("json"), Type.Literal("jsonl")]),
    reference: Type.String(),
    purpose: Type.Optional(Type.String()),
    identity: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const AGENT_WORKSPACE_CHANGE_CONTRACT_SCHEMA = Type.Object(
  {
    path: Type.String(),
    format: Type.Literal("jsonl"),
    reference: Type.String(),
    identity: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/** 磁盘 contract、脚本运行时与模型声明共同消费的外壳 Schema。 */
export const AGENT_WORKSPACE_CONTRACT_SCHEMA = Type.Object(
  {
    datasets: Type.Record(Type.String(), AGENT_WORKSPACE_DATASET_CONTRACT_SCHEMA),
    changes: Type.Record(
      Type.String(),
      Type.Record(Type.String(), AGENT_WORKSPACE_CHANGE_CONTRACT_SCHEMA),
    ),
    apply: open_record_schema,
  },
  { additionalProperties: false },
);

export const AGENT_WORKSPACE_FP_SCHEMA = Type.String({
  minLength: AGENT_WORKSPACE_FP_LENGTH,
  maxLength: AGENT_WORKSPACE_FP_LENGTH,
  pattern: "^[A-Za-z0-9_-]+$",
  description: "从当前快照原样复制对象指纹，提交时用它检查对象是否已变化。",
});

/** pages 复用 PDF 内容结构，工作区只增加对象身份与并发校验字段。 */
export const AGENT_WORKSPACE_PAGE_SCHEMA = Type.Object(
  {
    file_path: Type.String({ minLength: 1 }),
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    digest: PDF_DOCUMENT_SCHEMA.properties.digest,
    ...PDF_PAGE_SCHEMA.properties,
  },
  { additionalProperties: false },
);
export const AGENT_WORKSPACE_PAGE_UPDATE_SCHEMA = Type.Object(
  {
    file_path: Type.String({ minLength: 1 }),
    page: PDF_PAGE_SCHEMA.properties.page,
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    ...PDF_PAGE_UPDATE_SCHEMA.properties,
  },
  { additionalProperties: false },
);

export const AGENT_WORKSPACE_ITEM_SCHEMA = Type.Object(
  {
    item_id: Type.Integer({ minimum: 1 }),
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    src: Type.String(),
    dst: Type.String(),
    name_src: Type.String(),
    name_dst: Type.String(),
    file_path: Type.String(),
    text_type: Type.Enum(ITEM_TEXT_TYPES),
    row_number: Type.Integer({ minimum: 0 }),
    status: Type.Enum(ITEM_STATUSES),
    retry_count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AgentWorkspaceItem = Static<typeof AGENT_WORKSPACE_ITEM_SCHEMA>;

// 与共享校对联合类型保持一致，按规则限定字段和证据形状。
const proofreading_warning_schema = Type.Union([
  Type.Object(
    {
      code: Type.Literal("FOREIGN_CHAR_RESIDUE"),
      target_field: Type.Enum(["dst", "name_dst"]),
      fragments: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      code: Type.Literal("TEXT_PRESERVE"),
      target_field: Type.Enum(["dst", "name_dst"]),
      source_fragments: Type.Array(Type.String()),
      translation_fragments: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      code: Type.Enum(["PUNCTUATION_MISMATCH", "GLOSSARY"]),
      target_field: Type.Enum(["dst", "name_dst"]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      code: Type.Enum(["SIMILARITY", "LINE_COUNT_MISMATCH"]),
      target_field: Type.Literal("dst"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      code: Type.Literal("RETRY_THRESHOLD"),
      target_field: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);

export const AGENT_WORKSPACE_WARNING_SCHEMA = Type.Object(
  {
    item_id: Type.Integer({ minimum: 1 }),
    warnings: Type.Array(proofreading_warning_schema),
    glossary_applications: Type.Array(
      Type.Object(
        {
          entry_id: Type.String(),
          src: Type.String(),
          dst: Type.String(),
          case_sensitive: Type.Boolean(),
          fields: Type.Array(
            Type.Object(
              {
                source_field: Type.Union([Type.Literal("src"), Type.Literal("name_src")]),
                target_field: Type.Union([Type.Literal("dst"), Type.Literal("name_dst")]),
                applied: Type.Boolean(),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type AgentWorkspaceWarning = Static<typeof AGENT_WORKSPACE_WARNING_SCHEMA>;

/** Runtime 方法只依赖 contract 的稳定路径和限制视图；其余开放字段原样投影给模型。 */
export type AgentWorkspaceRuntimeContract = Readonly<
  Static<typeof AGENT_WORKSPACE_CONTRACT_SCHEMA>
>;

const UPDATE_MIN_PROPERTIES = 3; // 身份、指纹与至少一个待更新字段

export const AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA = Type.Object(
  {
    item_id: Type.Integer({ minimum: 1 }),
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    dst: Type.Optional(Type.String()),
    name_dst: Type.Optional(Type.String()),
    status: Type.Optional(Type.Enum(ITEM_MANUAL_STATUSES)),
  },
  {
    additionalProperties: false,
    minProperties: UPDATE_MIN_PROPERTIES,
    description: "提供对象身份、指纹和至少一个待修改字段，省略的字段保留当前值。",
  },
);

export const AGENT_WORKSPACE_PROMPTS_SCHEMA = Type.Object(
  Object.fromEntries(
    PROMPT_KINDS.map((kind) => [
      kind,
      Type.Object(
        { fp: AGENT_WORKSPACE_FP_SCHEMA, text: Type.String() },
        { additionalProperties: false },
      ),
    ]),
  ),
  { additionalProperties: false },
);

export const AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA = Type.Object(
  {
    kind: Type.Enum(PROMPT_KINDS),
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    text: Type.String(),
  },
  { additionalProperties: false },
);

/** project_meta.json 只承载解释快照所需的语言、数量和文件顺序。 */
export const AGENT_WORKSPACE_PROJECT_META_SCHEMA = Type.Object(
  {
    source_language: Type.String(),
    target_language: Type.String(),
    counts: Type.Object(
      {
        files: Type.Integer({ minimum: 0 }),
        items: Type.Integer({ minimum: 0 }),
        pages: Type.Integer({ minimum: 0 }),
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
        },
        { additionalProperties: false },
      ),
      { description: "按工作区文件顺序排列" },
    ),
  },
  { additionalProperties: false },
);

/** quality 字段形状沿用真实领域类型，不建立 Agent 专用别名。 */
const QUALITY_FIELD_SCHEMAS = {
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
} satisfies {
  [Kind in QualityRuleKind]: Record<
    (typeof AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS)[Kind][number],
    TSchema
  >;
};

const QUALITY_SORT_SCHEMA = Type.Integer({
  minimum: -1,
  description:
    "-1 表示追加到末尾。非负值表示从 0 开始的插入位置，超出当前长度时追加到末尾。更新时省略此字段可保留相对顺序。批次内的处理顺序见当前规则的参考文档。",
});

/** 每类记录的结构在此生成，参考文档与变更解析使用同一对象。 */
function create_quality_schemas(kind: QualityRuleKind) {
  const fields = QUALITY_FIELD_SCHEMAS[kind];
  return {
    entries: Type.Object(
      {
        id: Type.String(),
        fp: AGENT_WORKSPACE_FP_SCHEMA,
        sort: Type.Integer({ minimum: 0, description: "当前在数组中的位置，从 0 开始。" }),
        ...fields,
      },
      { additionalProperties: false },
    ),
    creates: Type.Object(
      { ...fields, sort: QUALITY_SORT_SCHEMA },
      {
        additionalProperties: false,
        description: "提供全部业务字段和排序位置，由宿主分配对象标识。",
      },
    ),
    updates: Type.Object(
      {
        id: Type.String(),
        fp: AGENT_WORKSPACE_FP_SCHEMA,
        ...Object.fromEntries(
          Object.entries(fields).map(([name, schema]) => [name, Type.Optional(schema)]),
        ),
        sort: Type.Optional(QUALITY_SORT_SCHEMA),
      },
      {
        additionalProperties: false,
        minProperties: UPDATE_MIN_PROPERTIES,
        description: "提供对象身份、指纹，以及至少一个业务字段或排序位置。省略的字段保留当前值。",
      },
    ),
    deletes: Type.Object(
      { id: Type.String(), fp: AGENT_WORKSPACE_FP_SCHEMA },
      { additionalProperties: false },
    ),
  };
}

export const AGENT_WORKSPACE_QUALITY_SCHEMAS = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [kind, create_quality_schemas(kind)]),
) as Record<QualityRuleKind, ReturnType<typeof create_quality_schemas>>;
