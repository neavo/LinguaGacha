import { Item, ITEM_STATUSES } from "../../domain/item";
import { read_json_integer, type JsonRecord } from "../../domain/json";
import { PROMPT_KINDS } from "../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import { read_optional_item_name_text } from "../../shared/item-name";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_WARNING_CODES,
  type ProofreadingClientItem,
  type ProofreadingManualStatusCode,
} from "../../shared/proofreading/proofreading-types";

/** 工作区固定相对路径；宿主协议与 Backend 只消费这份布局词表。 */
export const AGENT_WORKSPACE_PATHS = Object.freeze({
  manifest: "manifest.json",
  contract: "contract.json",
  items: "editable/items.jsonl",
  prompts: "editable/prompts.json",
  warnings: "derived/warnings.jsonl",
  analysis: "derived/analysis.json",
  analysisCandidates: "derived/analysis_candidates.jsonl",
  files: "context/files.jsonl",
} as const);

/** 四类质量规则的 editable 路径由领域 kind 确定生成。 */
export const AGENT_WORKSPACE_QUALITY_PATHS = Object.freeze(
  Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => [kind, `editable/quality/${kind}.jsonl`]),
  ) as Record<QualityRuleKind, string>,
);

/** 质量分析与对应规则使用相同 kind，禁止模型自行重建关系。 */
export const AGENT_WORKSPACE_QUALITY_ANALYSIS_PATHS = Object.freeze(
  Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => [kind, `derived/quality_analysis/${kind}.json`]),
  ) as Record<QualityRuleKind, string>,
);

/** 随应用发布且允许模型调用的只读 recipe 白名单。 */
export const AGENT_WORKSPACE_RECIPE_NAMES = Object.freeze([
  "inspect-items",
  "inspect-quality",
] as const);

/** recipe 名称与工作区只读脚本路径共享同一投影。 */
export const AGENT_WORKSPACE_RECIPE_PATHS = Object.freeze(
  Object.fromEntries(
    AGENT_WORKSPACE_RECIPE_NAMES.map((name) => [name, `recipes/${name}.js`]),
  ) as Record<(typeof AGENT_WORKSPACE_RECIPE_NAMES)[number], string>,
);

/** items.jsonl 的完整固定字段和顺序。 */
export const AGENT_WORKSPACE_ITEM_FIELDS = Object.freeze([
  "item_id",
  "src",
  "dst",
  "name_src",
  "name_dst",
  "file_path",
  "row_number",
  "status",
  "retry_count",
] as const);

/** item 字段白名单中真正允许 apply 的人工更新字段。 */
export const AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS = Object.freeze([
  "dst",
  "name_dst",
  "status",
] as const);

/** 四类质量规则各自的完整最终集合字段。 */
export const AGENT_WORKSPACE_QUALITY_FIELDS = Object.freeze({
  glossary: ["id", "src", "dst", "info", "case_sensitive"],
  text_preserve: ["id", "src", "info"],
  pre_replacement: ["id", "src", "dst", "regex", "case_sensitive"],
  post_replacement: ["id", "src", "dst", "regex", "case_sensitive"],
} as const satisfies Record<QualityRuleKind, readonly string[]>);

/** item 字段元数据同时服务模型理解与宿主 editable 白名单。 */
const ITEM_FIELD_CONTRACT: JsonRecord = {
  item_id: { type: "positive_integer", writable: false, purpose: "稳定条目身份" },
  src: { type: "string", writable: false, purpose: "原文正文" },
  dst: { type: "string", writable: true, purpose: "译文正文" },
  name_src: { type: "string", writable: false, purpose: "原文姓名" },
  name_dst: { type: "string", writable: true, purpose: "译文姓名" },
  file_path: { type: "string", writable: false, purpose: "工程相对文件身份" },
  row_number: { type: "non_negative_integer", writable: false, purpose: "文件内定位" },
  status: {
    type: "enum",
    writable: true,
    purpose: "条目状态；主动修改只接受人工状态",
    values: [...ITEM_STATUSES],
    writable_values: [...PROOFREADING_MANUAL_STATUS_CODES],
  },
  retry_count: { type: "non_negative_integer", writable: false, purpose: "重试事实" },
};

/** quality 字段形状沿用真实领域类型，不暴露 enabled 等功能状态。 */
const QUALITY_FIELD_CONTRACT: Record<QualityRuleKind, JsonRecord> = {
  glossary: {
    id: { type: "string", writable: false, optional_for_new: true },
    src: { type: "string", writable: true },
    dst: { type: "string", writable: true },
    info: { type: "string", writable: true },
    case_sensitive: { type: "boolean", writable: true },
  },
  text_preserve: {
    id: { type: "string", writable: false, optional_for_new: true },
    src: { type: "string", writable: true },
    info: { type: "string", writable: true },
  },
  pre_replacement: {
    id: { type: "string", writable: false, optional_for_new: true },
    src: { type: "string", writable: true },
    dst: { type: "string", writable: true },
    regex: { type: "boolean", writable: true },
    case_sensitive: { type: "boolean", writable: true },
  },
  post_replacement: {
    id: { type: "string", writable: false, optional_for_new: true },
    src: { type: "string", writable: true },
    dst: { type: "string", writable: true },
    regex: { type: "boolean", writable: true },
    case_sensitive: { type: "boolean", writable: true },
  },
};

/** 四类 quality 共享完整集合 apply 语义，只保留字段差异。 */
const quality_datasets = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [
    `quality.${kind}`,
    {
      id: `quality.${kind}`,
      path: AGENT_WORKSPACE_QUALITY_PATHS[kind],
      format: "jsonl",
      role: "editable",
      purpose: `${kind} 规则的完整最终有序集合`,
      identity: ["id"],
      order: "final_collection",
      fields: QUALITY_FIELD_CONTRACT[kind],
      apply_semantics: {
        existing_id_immutable: true,
        new_entry_omits_id: true,
        removed_row_means_delete: true,
      },
    },
  ]),
) as JsonRecord;

/** 每类后端分析与对应 editable kind 建立一一映射。 */
const quality_analysis_datasets = Object.fromEntries(
  QUALITY_RULE_KINDS.map((kind) => [
    `quality_analysis.${kind}`,
    {
      id: `quality_analysis.${kind}`,
      path: AGENT_WORKSPACE_QUALITY_ANALYSIS_PATHS[kind],
      format: "json",
      role: "derived",
      purpose: `${kind} 的后端命中、例句与结构组`,
      identity: ["entry_ids"],
      order: "preserve",
      fields: {},
    },
  ]),
) as JsonRecord;

/** 工作区结构、字段、可写性和生命周期的唯一代码权威。 */
export const AGENT_WORKSPACE_CONTRACT: JsonRecord = Object.freeze({
  datasets: {
    items: {
      id: "items",
      path: AGENT_WORKSPACE_PATHS.items,
      format: "jsonl",
      role: "editable",
      purpose: "完整条目集合",
      identity: ["item_id"],
      order: "preserve",
      fields: ITEM_FIELD_CONTRACT,
      apply_semantics: {
        fixed_identity_and_order: true,
        non_empty_dst_sets_processed: true,
        explicit_status_wins: true,
        status_change_resets_retry_count: true,
      },
    },
    prompts: {
      id: "prompts",
      path: AGENT_WORKSPACE_PATHS.prompts,
      format: "json",
      role: "editable",
      purpose: "两类提示词正文",
      identity: [...PROMPT_KINDS],
      order: "irrelevant",
      fields: Object.fromEntries(
        PROMPT_KINDS.map((kind) => [kind, { type: "string", writable: true }]),
      ),
      apply_semantics: { fixed_keys: [...PROMPT_KINDS] },
    },
    ...quality_datasets,
    warnings: {
      id: "warnings",
      path: AGENT_WORKSPACE_PATHS.warnings,
      format: "jsonl",
      role: "derived",
      purpose: "完整校对警告与证据",
      identity: ["item_id"],
      order: "preserve",
      fields: { warnings: { type: "enum_array", values: [...PROOFREADING_WARNING_CODES] } },
    },
    analysis: {
      id: "analysis",
      path: AGENT_WORKSPACE_PATHS.analysis,
      format: "json",
      role: "derived",
      purpose: "分析状态摘要",
      identity: [],
      order: "irrelevant",
      fields: {},
    },
    analysis_candidates: {
      id: "analysis_candidates",
      path: AGENT_WORKSPACE_PATHS.analysisCandidates,
      format: "jsonl",
      role: "derived",
      purpose: "完整分析候选池",
      identity: ["src"],
      order: "preserve",
      fields: {},
    },
    ...quality_analysis_datasets,
    files: {
      id: "files",
      path: AGENT_WORKSPACE_PATHS.files,
      format: "jsonl",
      role: "context",
      purpose: "工程文件身份与顺序",
      identity: ["rel_path"],
      order: "preserve",
      fields: {
        rel_path: { type: "string", writable: false },
        file_type: { type: "string", writable: false },
        sort_index: { type: "non_negative_integer", writable: false },
      },
    },
  },
  script_api: {
    methods: [
      "readText",
      "readJson",
      "readLines",
      "readJsonl",
      "writeText",
      "writeJson",
      "writeJsonl",
      "list",
      "remove",
      "runRecipe",
    ],
    writable: ["editable 固定文件", "scratch/"],
  },
  recipes: {
    "inspect-items": { purpose: "筛选条目并联结后端警告证据", readonly: true },
    "inspect-quality": { purpose: "筛选质量规则并联结后端分析证据", readonly: true },
  },
  lifecycle: {
    create_replaces_active_after_success: true,
    run_failure_discards_workspace: true,
    apply_is_atomic: true,
    apply_success_or_unchanged_discards_workspace: true,
    validation_error_keeps_workspace: true,
    stale_discards_workspace: true,
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
    row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
    status: Item.normalize_status(item["status"]),
    retry_count: read_json_integer(item["retry_count"], 0),
  };
}

/** warning 复用 item 投影，并按值复制嵌套证据。 */
export function project_agent_workspace_warning(item: ProofreadingClientItem): JsonRecord {
  return {
    ...project_agent_workspace_item({ ...item }),
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
      field === "id" ? String(entry["entry_id"] ?? "") : (entry[field] ?? null),
    ]),
  ) as JsonRecord;
}

/** 工作区主动状态更新只接受校对菜单暴露的人工状态。 */
export function is_agent_workspace_manual_status(
  value: unknown,
): value is ProofreadingManualStatusCode {
  return (PROOFREADING_MANUAL_STATUS_CODES as readonly unknown[]).includes(value);
}
