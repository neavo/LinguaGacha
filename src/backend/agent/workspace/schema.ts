import {
  PDF_DOCUMENT_SCHEMA,
  PDF_PAGE_SCHEMA,
  PDF_PAGE_UPDATE_SCHEMA,
} from "../../../shared/pdf-schema";
import { Type, type Static } from "@earendil-works/pi-ai";

import {
  PROJECT_ITEM_PUBLIC_SCHEMA,
  PROJECT_ITEM_MANUAL_UPDATE_SCHEMA,
} from "../../../domain/item";

import { PROMPT_KINDS, TRANSLATION_PROMPT_SLICE_SCHEMA } from "../../../domain/prompt";
import {
  QUALITY_RULE_KINDS,
  QUALITY_RULE_BUSINESS_SCHEMAS,
  type QualityRuleKind,
} from "../../../domain/quality";

export const AGENT_WORKSPACE_FP_SCHEMA = Type.String({
  minLength: 1,
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
    item_id: PROJECT_ITEM_PUBLIC_SCHEMA.properties.item_id,
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    src: PROJECT_ITEM_PUBLIC_SCHEMA.properties.src,
    dst: PROJECT_ITEM_PUBLIC_SCHEMA.properties.dst,
    name_src: Type.String(),
    name_dst: Type.String(),
    file_path: PROJECT_ITEM_PUBLIC_SCHEMA.properties.file_path,
    text_type: PROJECT_ITEM_PUBLIC_SCHEMA.properties.text_type,
    row_number: Type.Integer({ minimum: 0 }),
    status: PROJECT_ITEM_PUBLIC_SCHEMA.properties.status,
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

const UPDATE_MIN_PROPERTIES = 3; // 身份、指纹与至少一个待更新字段

export const AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA = Type.Object(
  {
    item_id: PROJECT_ITEM_PUBLIC_SCHEMA.properties.item_id,
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    ...PROJECT_ITEM_MANUAL_UPDATE_SCHEMA.properties,
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
        { fp: AGENT_WORKSPACE_FP_SCHEMA, text: TRANSLATION_PROMPT_SLICE_SCHEMA.properties.text },
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
    text: TRANSLATION_PROMPT_SLICE_SCHEMA.properties.text,
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

const QUALITY_SORT_SCHEMA = Type.Integer({
  minimum: -1,
  description:
    "-1 表示追加到末尾。非负值表示从 0 开始的插入位置，超出当前长度时追加到末尾。更新时省略此字段可保留相对顺序。批次内的处理顺序见当前规则的参考文档。",
});

/** 每类记录的结构在此生成，参考文档与变更解析使用同一对象。 */
function create_quality_schemas(kind: QualityRuleKind) {
  const fields = QUALITY_RULE_BUSINESS_SCHEMAS[kind].properties;
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
