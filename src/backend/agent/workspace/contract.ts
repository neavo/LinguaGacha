import type { TSchema } from "@earendil-works/pi-ai";

import { read_json_integer, type JsonRecord } from "../../../domain/json";
import { PROMPT_KINDS } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import type { ProofreadingClientItem } from "../../../shared/proofreading/proofreading-types";
import {
  AGENT_WORKSPACE_ITEM_SCHEMA,
  AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROMPTS_SCHEMA,
  AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROJECT_META_SCHEMA,
  AGENT_WORKSPACE_QUALITY_SCHEMAS,
  AGENT_WORKSPACE_WARNING_SCHEMA,
  type AgentWorkspaceRuntimeContract,
} from "./schema";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./runtime/policy";

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

/** 标准 Schema 作为 JSON 写入磁盘契约，类型转换集中在序列化边界。 */
const schema_record = (schema: TSchema): JsonRecord => schema as unknown as JsonRecord;

/** 按规则类型组合固定路径与对应记录 Schema。 */
const quality_entry_datasets = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    {
      path: AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind],
      format: "jsonl",
      purpose: `${kind} 规则的完整只读有序集合`,
      identity: ["id"],
      schema: schema_record(AGENT_WORKSPACE_QUALITY_SCHEMAS[kind].entries),
    },
  ]),
);
const quality_changes = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [
    kind,
    Object.fromEntries(
      AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map((operation) => [
        operation,
        {
          path: AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
          format: "jsonl",
          schema: schema_record(AGENT_WORKSPACE_QUALITY_SCHEMAS[kind][operation]),
        },
      ]),
    ),
  ]),
);

/** 磁盘契约与工具说明共用完整类型，保留提交语义供调用前发现。 */
export const AGENT_WORKSPACE_CONTRACT = Object.freeze({
  limits: {
    result_bytes: AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes,
    query_page_default: AGENT_WORKSPACE_RUNTIME_POLICY.queryPageDefault,
    query_page_max: AGENT_WORKSPACE_RUNTIME_POLICY.queryPageMax,
  },
  datasets: {
    project_meta: {
      path: AGENT_WORKSPACE_PATHS.projectMeta,
      format: "json",
      purpose: "工程语言、完整数量与文件顺序",
      schema: schema_record(AGENT_WORKSPACE_PROJECT_META_SCHEMA),
    },
    items: {
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl",
      purpose: "完整只读条目集合",
      identity: ["item_id"],
      schema: schema_record(AGENT_WORKSPACE_ITEM_SCHEMA),
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
      purpose: "翻译提示词对象基线与只读正文",
      identity: [...PROMPT_KINDS],
      schema: schema_record(AGENT_WORKSPACE_PROMPTS_SCHEMA),
    },
    ...quality_entry_datasets,
  },
  changes: {
    items: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
        format: "jsonl",
        identity: ["item_id"],
        schema: schema_record(AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA),
      },
    },
    prompts: {
      updates: {
        path: AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
        format: "jsonl",
        identity: ["kind"],
        schema: schema_record(AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA),
      },
    },
    ...quality_changes,
  },
  effects: {
    item_updates: {
      changed_dst: { status: "PROCESSED", retry_count: 0 },
      confirmed_error_dst: { status: "PROCESSED", retry_count: 0 },
      name_dst: { status: "preserve", retry_count: "preserve" },
      explicit_status: { precedence: "after_dst", retry_count: 0 },
      duplicate_group: {
        key: ["file_path", "src"],
        status: "automatic",
        affected_values: ["NONE", "DUPLICATED"],
      },
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
    quality_operations:
      "按完整批次处理 creates、updates、deletes；已接受的删除使同对象更新进入 merge_conflict，依赖删除的新增或更新在删除失败时可能进入 dependency_conflict。",
    quality_sort:
      "先移除删除对象与显式排序对象，保留其余相对顺序；按非负 sort 升序插入，-1 最后追加。同位置先更新后创建，各自按 change 文件行序排列；最终执行领域归一化。",
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
      status: {
        applied: "有实际变化且无拒绝",
        partial: "有实际变化且有拒绝",
        rejected: "无实际变化且有拒绝",
        unchanged: "无实际变化且无拒绝",
      },
      fields: ["status", "applied", "rejected", "destroyed", "revisions"],
      destroyed: "真实提交或目标事实漂移后为 true；输入错误、无变化和事务回滚后为 false",
    },
  },
} satisfies AgentWorkspaceRuntimeContract);

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
