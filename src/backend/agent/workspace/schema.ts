import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";

import { ITEM_MANUAL_STATUSES, ITEM_STATUSES, ITEM_TEXT_TYPES } from "../../../domain/item";
import {
  PROOFREADING_WARNING_CODES,
  PROOFREADING_WARNING_FRAGMENT_CODES,
} from "../../../shared/proofreading/proofreading-types";

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
    schema: open_record_schema,
    purpose: Type.Optional(Type.String()),
    identity: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const AGENT_WORKSPACE_CHANGE_CONTRACT_SCHEMA = Type.Object(
  {
    path: Type.String(),
    format: Type.Literal("jsonl"),
    schema: open_record_schema,
    identity: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/** 磁盘 contract、Deno 类型视图与模型声明共同消费的外壳 Schema。 */
export const AGENT_WORKSPACE_CONTRACT_SCHEMA = Type.Object(
  {
    limits: Type.Object(
      {
        result_bytes: Type.Integer({ minimum: 1 }),
        query_page_default: Type.Integer({ minimum: 1 }),
        query_page_max: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    datasets: Type.Record(Type.String(), AGENT_WORKSPACE_DATASET_CONTRACT_SCHEMA),
    changes: Type.Record(
      Type.String(),
      Type.Record(Type.String(), AGENT_WORKSPACE_CHANGE_CONTRACT_SCHEMA),
    ),
    effects: open_record_schema,
    guidance: open_record_schema,
    apply: open_record_schema,
  },
  { additionalProperties: false },
);

/** 保留领域字面量类型，使 Schema 校验同时收窄 TypeScript 值域。 */
const literal_union = <const T extends readonly (string | number | boolean)[]>(values: T) =>
  Type.Union(values.map((value: T[number]) => Type.Literal(value)));

export const AGENT_WORKSPACE_FP_SCHEMA = Type.String({
  minLength: AGENT_WORKSPACE_FP_LENGTH,
  maxLength: AGENT_WORKSPACE_FP_LENGTH,
  pattern: "^[A-Za-z0-9_-]+$",
  description: "从当前快照原样复制的对象事实指纹，用于提交时校验对象是否变化。",
});

export const AGENT_WORKSPACE_ITEM_SCHEMA = Type.Object(
  {
    item_id: Type.Integer({ minimum: 1 }),
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    src: Type.String(),
    dst: Type.String(),
    name_src: Type.String(),
    name_dst: Type.String(),
    file_path: Type.String(),
    text_type: literal_union(ITEM_TEXT_TYPES),
    row_number: Type.Integer({ minimum: 0 }),
    status: literal_union(ITEM_STATUSES),
    retry_count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AgentWorkspaceItem = Static<typeof AGENT_WORKSPACE_ITEM_SCHEMA>;

const warning_fragments = Object.fromEntries(
  PROOFREADING_WARNING_FRAGMENT_CODES.map((code) => [
    code,
    Type.Optional(Type.Array(Type.String())),
  ]),
);

export const AGENT_WORKSPACE_WARNING_SCHEMA = Type.Object(
  {
    item_id: Type.Integer({ minimum: 1 }),
    warnings: Type.Array(literal_union(PROOFREADING_WARNING_CODES)),
    warning_fragments_by_code: Type.Object(warning_fragments, { additionalProperties: false }),
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
    status: Type.Optional(literal_union(ITEM_MANUAL_STATUSES)),
  },
  {
    additionalProperties: false,
    minProperties: UPDATE_MIN_PROPERTIES,
    description: "携带对象身份与至少一个实际修改的字段；省略字段保持当前值。",
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
    kind: Type.Union(PROMPT_KINDS.map((kind) => Type.Literal(kind))),
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
    "-1 表示追加，非负值为零基插入位置，超出当前长度时追加；更新时省略保留相对顺序。批次内顺序见 contract.apply.quality_sort。",
});

/** 每类记录的结构在此生成，磁盘契约与变更解析使用同一对象。 */
function create_quality_schemas(kind: QualityRuleKind) {
  const fields = QUALITY_FIELD_SCHEMAS[kind];
  return {
    entries: Type.Object(
      {
        id: Type.String(),
        fp: AGENT_WORKSPACE_FP_SCHEMA,
        sort: Type.Integer({ minimum: 0, description: "当前零基数组位置。" }),
        ...fields,
      },
      { additionalProperties: false },
    ),
    creates: Type.Object(
      { ...fields, sort: QUALITY_SORT_SCHEMA },
      {
        additionalProperties: false,
        description: "完整业务字段和明确排序意图；身份由宿主分配。",
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
        description: "携带对象身份与至少一个业务字段或排序意图；省略字段保持当前值。",
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
