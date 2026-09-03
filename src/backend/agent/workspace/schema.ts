import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";

import {
  ITEM_MANUAL_STATUSES,
  ITEM_STATUSES,
  ITEM_TEXT_TYPES,
  type ItemStatus,
  type ItemTextType,
} from "../../../domain/item";
import {
  PROOFREADING_WARNING_CODES,
  PROOFREADING_WARNING_FRAGMENT_CODES,
  type ProofreadingWarningCode,
} from "../../../shared/proofreading/proofreading-types";

/** 单个字面模式最多回传的证据条目数。 */
export const AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES = 50;

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
        literal_match_examples_default: Type.Integer({ minimum: 0 }),
        literal_match_examples_max: Type.Integer({ minimum: 0 }),
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

const literal_union = <const T extends readonly (string | number | boolean)[]>(values: T) =>
  Type.Union(
    values.map((value) => Type.Literal(value)) as unknown as [TSchema, TSchema, ...TSchema[]],
  );

export const AGENT_WORKSPACE_FP_SCHEMA = Type.String({
  description: "基于对象事实计算的当前快照指纹",
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

type AgentWorkspaceItemStatic = Static<typeof AGENT_WORKSPACE_ITEM_SCHEMA>;
export type AgentWorkspaceItem = Omit<AgentWorkspaceItemStatic, "status" | "text_type"> & {
  status: ItemStatus;
  text_type: ItemTextType;
};

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

type AgentWorkspaceWarningStatic = Static<typeof AGENT_WORKSPACE_WARNING_SCHEMA>;
export type AgentWorkspaceWarning = Omit<AgentWorkspaceWarningStatic, "warnings"> & {
  warnings: ProofreadingWarningCode[];
};

/** Runtime 方法只依赖 contract 的稳定路径和限制视图；其余开放字段原样投影给模型。 */
export type AgentWorkspaceRuntimeContract = Readonly<
  Static<typeof AGENT_WORKSPACE_CONTRACT_SCHEMA>
>;

export const AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA = Type.Object(
  {
    item_id: Type.Integer({ minimum: 1 }),
    fp: AGENT_WORKSPACE_FP_SCHEMA,
    dst: Type.Optional(Type.String()),
    name_dst: Type.Optional(Type.String()),
    status: Type.Optional(literal_union(ITEM_MANUAL_STATUSES)),
  },
  { additionalProperties: false },
);
