import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { is_json_record, read_json_record, type JsonRecord } from "../../domain/json";
import { Prompt, PROMPT_KINDS } from "../../domain/prompt";
import { QualityRule, QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import * as AppErrors from "../../shared/error";
import {
  collect_quality_rule_duplicate_groups,
  QualityRuleImportRuleTypeValue,
  type QualityRuleImportRuleType,
} from "../../shared/quality/quality-rule-import";
import {
  create_quality_rule_entry_id,
  normalize_quality_rule_entries,
} from "../../shared/quality/quality-rule-entry";
import { JsonTool } from "../../shared/utils/json-tool";
import { iterate_utf8_lf_lines } from "../../shared/utils/text-tool";
import type { NativeFs } from "../../native/native-fs";
import type { CacheReadPort } from "../cache/cache-types";
import {
  apply_proofreading_item_update,
  are_proofreading_item_write_fields_equal,
  type ProofreadingItemUpdateFields,
} from "../proofreading/proofreading-item-update";
import type {
  AgentWorkspacePromptChange,
  AgentWorkspaceQualityChange,
  ProjectItemWriteChange,
} from "../project/project-write-request";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_FIELDS,
  is_agent_workspace_manual_status,
} from "./agent-workspace-contract";

/** 单个 quality kind 的真实创建、字段更新、删除与移动回执。 */
export type AgentWorkspaceQualitySummary = Readonly<{
  created: number;
  updated: number;
  deleted: number;
  moved: number;
}>;

/** 已通过 change 与领域校验、可直接交给项目事务的不可变差异。 */
export type PreparedAgentWorkspaceChanges = Readonly<{
  itemChanges: ProjectItemWriteChange[];
  qualityChanges: AgentWorkspaceQualityChange[];
  promptChanges: AgentWorkspacePromptChange[];
  qualitySummary: Partial<Record<QualityRuleKind, AgentWorkspaceQualitySummary>>;
}>;

/** 工作区 kind 到共享重复组规则类型的唯一适配。 */
const DUPLICATE_RULE_TYPE_BY_KIND = Object.freeze({
  glossary: QualityRuleImportRuleTypeValue.GLOSSARY,
  pre_replacement: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
  post_replacement: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
  text_preserve: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
} satisfies Record<QualityRuleKind, QualityRuleImportRuleType>);

/** 只消费固定显式 change 文件；完整快照永远不参与 diff。 */
export async function prepare_agent_workspace_changes(args: {
  nativeFs: NativeFs;
  workspacePath: string;
  cache: CacheReadPort;
}): Promise<PreparedAgentWorkspaceChanges> {
  const itemChanges = await prepare_item_changes(args);
  const promptChanges = await prepare_prompt_changes(args);
  const { changes: qualityChanges, summary: qualitySummary } = await prepare_quality_changes(args);
  return { itemChanges, promptChanges, qualityChanges, qualitySummary };
}

/** item change 按稳定 ID 定点读取，只形成真实人工字段差异。 */
async function prepare_item_changes(args: {
  nativeFs: NativeFs;
  workspacePath: string;
  cache: CacheReadPort;
}): Promise<ProjectItemWriteChange[]> {
  const rows = await read_change_rows(
    args.nativeFs,
    path.join(args.workspacePath, AGENT_WORKSPACE_CHANGE_PATHS.items.updates),
  );
  const seen = new Set<number>();
  const changes: ProjectItemWriteChange[] = [];
  for (const row of rows) {
    assert_exact_fields(
      row,
      ["item_id", ...AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS],
      AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
      "agent_workspace_invalid_item_update_fields",
    );
    if (!AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS.some((field) => has_own(row, field))) {
      throw change_validation_error("agent_workspace_empty_item_update");
    }
    const item_id = row["item_id"];
    if (
      typeof item_id !== "number" ||
      !Number.isInteger(item_id) ||
      item_id <= 0 ||
      seen.has(item_id)
    ) {
      throw change_validation_error("agent_workspace_invalid_item_update_id");
    }
    seen.add(item_id);
    const current = args.cache.items.readItem(item_id);
    if (current === null) throw change_validation_error("agent_workspace_item_not_found");
    const update: ProofreadingItemUpdateFields = {};
    if (has_own(row, "dst")) {
      if (typeof row["dst"] !== "string")
        throw change_validation_error("agent_workspace_invalid_item_update_value");
      Object.assign(update, { dst: row["dst"] });
    }
    if (has_own(row, "name_dst")) {
      if (typeof row["name_dst"] !== "string")
        throw change_validation_error("agent_workspace_invalid_item_update_value");
      Object.assign(update, { name_dst: row["name_dst"] });
    }
    if (has_own(row, "status")) {
      if (!is_agent_workspace_manual_status(row["status"])) {
        throw change_validation_error("agent_workspace_invalid_manual_status");
      }
      Object.assign(update, { status: row["status"] });
    }
    const next = apply_proofreading_item_update(current, update);
    if (!are_proofreading_item_write_fields_equal(current, next)) {
      changes.push({ item_id, current, next });
    }
  }
  return changes;
}

/** prompt change 只读取目标 kind，并拒绝同一 kind 的平行最终值。 */
async function prepare_prompt_changes(args: {
  nativeFs: NativeFs;
  workspacePath: string;
  cache: CacheReadPort;
}): Promise<AgentWorkspacePromptChange[]> {
  const rows = await read_change_rows(
    args.nativeFs,
    path.join(args.workspacePath, AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates),
  );
  if (rows.length === 0) return [];
  const current = project_workspace_prompts(args.cache.prompts.readBlock());
  const seen = new Set<string>();
  const changes: AgentWorkspacePromptChange[] = [];
  for (const row of rows) {
    assert_exact_fields(row, ["kind", "text"], [], "agent_workspace_invalid_prompt_update_fields");
    const kind = row["kind"];
    if (typeof kind !== "string" || !(PROMPT_KINDS as readonly string[]).includes(kind)) {
      throw change_validation_error("agent_workspace_invalid_prompt_kind");
    }
    if (seen.has(kind)) throw change_validation_error("agent_workspace_duplicate_prompt_update");
    seen.add(kind);
    const text = row["text"];
    if (typeof text !== "string")
      throw change_validation_error("agent_workspace_invalid_prompt_text");
    const prompt_kind = kind as AgentWorkspacePromptChange["kind"];
    if (text !== current[prompt_kind]) changes.push({ kind: prompt_kind, text });
  }
  return changes;
}

/** 只为存在显式操作的 quality kind 构造 prospective 最终集合。 */
async function prepare_quality_changes(args: {
  nativeFs: NativeFs;
  workspacePath: string;
  cache: CacheReadPort;
}): Promise<{
  changes: AgentWorkspaceQualityChange[];
  summary: Partial<Record<QualityRuleKind, AgentWorkspaceQualitySummary>>;
}> {
  const rows_by_kind = new Map<QualityRuleKind, QualityOperationRows>();
  for (const kind of QUALITY_RULE_KINDS) {
    const rows = Object.fromEntries(
      await Promise.all(
        AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map(
          async (operation) =>
            [
              operation,
              await read_change_rows(
                args.nativeFs,
                path.join(
                  args.workspacePath,
                  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
                ),
              ),
            ] as const,
        ),
      ),
    ) as QualityOperationRows;
    if (AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.some((operation) => rows[operation].length > 0)) {
      rows_by_kind.set(kind, rows);
    }
  }
  if (rows_by_kind.size === 0) return { changes: [], summary: {} };

  const quality_block = args.cache.quality.readBlock();
  const changes: AgentWorkspaceQualityChange[] = [];
  const summary: Partial<Record<QualityRuleKind, AgentWorkspaceQualitySummary>> = {};
  for (const [kind, rows] of rows_by_kind) {
    const current = read_quality_entries(quality_block, kind);
    const { next, moved } = apply_quality_operations(kind, current, rows);
    // 不把相互抵消的显式操作冒充真实变化，否则会无意义推进 quality revision。
    if (isDeepStrictEqual(current, next)) continue;
    assert_no_new_duplicate_groups(kind, current, next);
    const change_summary = summarize_quality_changes(current, next, moved);
    changes.push({ kind, entries: next });
    summary[kind] = change_summary;
  }
  return { changes, summary };
}

/** 单个 quality kind 的四类操作行，执行顺序由 contract 固定。 */
type QualityOperationRows = Record<
  (typeof AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS)[number],
  JsonRecord[]
>;

/** 按 delete → update → create → move 应用显式操作并复用领域归一化。 */
function apply_quality_operations(
  kind: QualityRuleKind,
  current: JsonRecord[],
  rows: QualityOperationRows,
): { next: JsonRecord[]; moved: number } {
  const current_ids = new Set(current.map(read_entry_id));
  const deleted_ids = read_unique_ids(
    rows.deletes,
    ["id"],
    "agent_workspace_invalid_quality_delete",
  );
  const updates = read_quality_updates(kind, rows.updates);
  const moves = read_quality_moves(rows.moves);
  const moved_ids = new Set(moves.map((move) => move.id));
  for (const id of deleted_ids) {
    if (!current_ids.has(id)) throw change_validation_error("agent_workspace_quality_id_not_found");
    if (updates.has(id) || moved_ids.has(id)) {
      throw change_validation_error("agent_workspace_conflicting_quality_change");
    }
  }
  for (const id of updates.keys()) {
    if (!current_ids.has(id)) throw change_validation_error("agent_workspace_quality_id_not_found");
  }
  for (const move of moves) {
    if (!current_ids.has(move.id) || deleted_ids.has(move.id)) {
      throw change_validation_error("agent_workspace_quality_id_not_found");
    }
    assert_quality_anchor(move.id, move.before_id, current_ids, deleted_ids);
  }

  let next = current
    .filter((entry) => !deleted_ids.has(read_entry_id(entry)))
    .map((entry) => {
      const update = updates.get(read_entry_id(entry));
      return update === undefined ? entry : { ...entry, ...update };
    });

  for (const row of rows.creates) {
    const create = read_quality_create(kind, row);
    assert_quality_anchor(null, create.before_id, current_ids, deleted_ids);
    const entry = { entry_id: create_quality_rule_entry_id(current_ids), ...create.fields };
    const index = find_anchor_index(next, create.before_id);
    next.splice(index, 0, entry);
  }
  let moved = 0;
  for (const move of moves) {
    const before_order = next.map(read_entry_id);
    const source_index = next.findIndex((entry) => read_entry_id(entry) === move.id);
    if (source_index < 0) throw change_validation_error("agent_workspace_quality_id_not_found");
    const [entry] = next.splice(source_index, 1);
    if (entry === undefined) throw change_validation_error("agent_workspace_quality_id_not_found");
    const target_index = find_anchor_index(next, move.before_id);
    next.splice(target_index, 0, entry);
    if (!isDeepStrictEqual(before_order, next.map(read_entry_id))) moved += 1;
  }

  try {
    return {
      next: normalize_quality_rule_entries(QualityRule.from_json(kind), next) as JsonRecord[],
      moved,
    };
  } catch (cause) {
    throw new AppErrors.AppError("request.validation_failed", {
      cause,
      public_details: { action: "workspace_script" },
      diagnostic_context: { reason: "agent_workspace_invalid_quality", kind },
    });
  }
}

/** update 只接受既有 ID 和至少一个当前 kind 的可变字段。 */
function read_quality_updates(kind: QualityRuleKind, rows: JsonRecord[]): Map<string, JsonRecord> {
  const fields = AGENT_WORKSPACE_QUALITY_FIELDS[kind].filter((field) => field !== "id");
  const updates = new Map<string, JsonRecord>();
  for (const row of rows) {
    assert_exact_fields(
      row,
      ["id", ...fields],
      fields,
      "agent_workspace_invalid_quality_update_fields",
    );
    if (!fields.some((field) => has_own(row, field))) {
      throw change_validation_error("agent_workspace_empty_quality_update");
    }
    const id = read_id(row["id"]);
    if (updates.has(id)) throw change_validation_error("agent_workspace_duplicate_quality_update");
    const update = Object.fromEntries(
      fields
        .filter((field) => has_own(row, field))
        .map((field) => {
          assert_quality_field_value(field, row[field]);
          return [field, row[field]];
        }),
    );
    updates.set(id, update);
  }
  return updates;
}

/** create 必须给出完整领域字段，排序锚点省略时追加到末尾。 */
function read_quality_create(
  kind: QualityRuleKind,
  row: JsonRecord,
): { fields: JsonRecord; before_id: string | null } {
  const fields = AGENT_WORKSPACE_QUALITY_FIELDS[kind].filter((field) => field !== "id");
  assert_exact_fields(
    row,
    [...fields, "before_id"],
    ["before_id"],
    "agent_workspace_invalid_quality_create_fields",
  );
  const values = Object.fromEntries(
    fields.map((field) => {
      assert_quality_field_value(field, row[field]);
      return [field, row[field]];
    }),
  );
  return { fields: values, before_id: read_before_id(row["before_id"]) };
}

/** move 的同一源 ID 只能出现一次，避免顺序语义依赖重复指令。 */
function read_quality_moves(rows: JsonRecord[]): Array<{ id: string; before_id: string | null }> {
  const seen = new Set<string>();
  return rows.map((row) => {
    assert_exact_fields(
      row,
      ["id", "before_id"],
      [],
      "agent_workspace_invalid_quality_move_fields",
    );
    const id = read_id(row["id"]);
    if (seen.has(id)) throw change_validation_error("agent_workspace_duplicate_quality_move");
    seen.add(id);
    return { id, before_id: read_before_id(row["before_id"]) };
  });
}

/** 删除等单 ID 操作拒绝未知字段和重复身份。 */
function read_unique_ids(
  rows: JsonRecord[],
  fields: readonly string[],
  reason: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    assert_exact_fields(row, fields, [], reason);
    const id = read_id(row["id"]);
    if (ids.has(id)) throw change_validation_error(reason);
    ids.add(id);
  }
  return ids;
}

/** 排序锚点必须指向本次操作后仍保留的既有条目。 */
function assert_quality_anchor(
  moving_id: string | null,
  before_id: string | null,
  current_ids: Set<string>,
  deleted_ids: Set<string>,
): void {
  if (before_id === null) return;
  if (before_id === moving_id || !current_ids.has(before_id) || deleted_ids.has(before_id)) {
    throw change_validation_error("agent_workspace_invalid_quality_anchor");
  }
}

/** null 表示末尾；非空锚点必须能在当前 prospective 集合中定位。 */
function find_anchor_index(entries: JsonRecord[], before_id: string | null): number {
  if (before_id === null) return entries.length;
  const index = entries.findIndex((entry) => read_entry_id(entry) === before_id);
  if (index < 0) throw change_validation_error("agent_workspace_invalid_quality_anchor");
  return index;
}

/** 字段类型先按 contract 收窄，完整领域语义随后由共享归一化器验证。 */
function assert_quality_field_value(field: string, value: unknown): void {
  const boolean_field = field === "regex" || field === "case_sensitive";
  if (
    (boolean_field && typeof value !== "boolean") ||
    (!boolean_field && typeof value !== "string")
  ) {
    throw change_validation_error("agent_workspace_invalid_quality_field_type");
  }
}

/** 可选排序锚点统一归一为非空 ID 或 null。 */
function read_before_id(value: unknown): string | null {
  return value === undefined || value === null ? null : read_id(value);
}

/** 工作区公开 quality ID 必须是非空字符串。 */
function read_id(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw change_validation_error("agent_workspace_invalid_quality_id");
  }
  return value;
}

/** 内部 quality 身份只在本模块用 entry_id 表示。 */
function read_entry_id(entry: JsonRecord): string {
  return String(entry["entry_id"]);
}

/** 当前 quality 集合统一校验项目身份与真实执行语义。 */
function read_quality_entries(quality: JsonRecord, kind: QualityRuleKind): JsonRecord[] {
  const entries = normalize_quality_rule_entries(
    QualityRule.from_json(kind),
    read_json_record(quality[kind])["entries"] ?? [],
  ) as JsonRecord[];
  return entries;
}

/** prompt 读侧只投影两类固定正文，不把 enabled 等设置带入工作区。 */
function project_workspace_prompts(block: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Prompt.all().map((prompt) => [prompt.kind, prompt.normalize_slice(block[prompt.kind]).text]),
  );
}

/** 允许缩小既有重复组，但禁止显式 change 新增或扩大重复冲突。 */
function assert_no_new_duplicate_groups(
  kind: QualityRuleKind,
  previous: JsonRecord[],
  next: JsonRecord[],
): void {
  const rule_type = DUPLICATE_RULE_TYPE_BY_KIND[kind];
  const previous_counts = new Map(
    collect_quality_rule_duplicate_groups({ rule_type, entries: previous }).map((group) => [
      group.key,
      group.indexes.length,
    ]),
  );
  const conflict = collect_quality_rule_duplicate_groups({ rule_type, entries: next }).find(
    (group) => group.indexes.length > (previous_counts.get(group.key) ?? 1),
  );
  if (conflict !== undefined) {
    throw change_validation_error("agent_workspace_quality_duplicate_expanded");
  }
}

/** 回执按稳定 ID 统计创建、字段更新、删除与生效的显式移动。 */
function summarize_quality_changes(
  current: JsonRecord[],
  next: JsonRecord[],
  moved: number,
): AgentWorkspaceQualitySummary {
  const current_by_id = new Map(current.map((entry) => [read_entry_id(entry), entry]));
  const next_by_id = new Map(next.map((entry) => [read_entry_id(entry), entry]));
  return {
    created: next.filter((entry) => !current_by_id.has(read_entry_id(entry))).length,
    updated: next.filter((entry) => {
      const previous = current_by_id.get(read_entry_id(entry));
      return previous !== undefined && !isDeepStrictEqual(previous, entry);
    }).length,
    deleted: current.filter((entry) => !next_by_id.has(read_entry_id(entry))).length,
    moved,
  };
}

/** 固定 change 行拒绝未知字段，并要求所有非可选字段存在。 */
function assert_exact_fields(
  value: JsonRecord,
  fields: readonly string[],
  optional: readonly string[],
  reason: string,
): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  const missing = fields.find(
    (field) => !optional.includes(field) && !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (unknown !== undefined || missing !== undefined) {
    throw new AppErrors.AppError("request.validation_failed", {
      public_details: { action: "workspace_script" },
      diagnostic_context: { reason, field: unknown ?? missing },
    });
  }
}

/** 可选字段必须按 JSON 自有属性判断，不能把显式空值当成缺失。 */
function has_own(value: JsonRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

/** 空 change 文件不创建 reader；大文件仍逐行流式解析。 */
async function read_change_rows(native_fs: NativeFs, file_path: string): Promise<JsonRecord[]> {
  try {
    if (!native_fs.exists(file_path)) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        public_details: { action: "workspace_load" },
        diagnostic_context: { reason: "agent_workspace_change_file_missing" },
      });
    }
    if (native_fs.stat(file_path).size === 0) return [];
    const rows: JsonRecord[] = [];
    let line_number = 0;
    for await (const line of iterate_utf8_lf_lines(native_fs.create_read_stream(file_path))) {
      line_number += 1;
      if (line.trim() === "") continue;
      const parsed = JsonTool.parseStrict(line);
      if (!is_json_record(parsed)) {
        throw new TypeError(`Workspace JSONL line ${line_number.toString()} is not an object.`);
      }
      rows.push(parsed);
    }
    return rows;
  } catch (cause) {
    if (AppErrors.is_app_error(cause)) throw cause;
    throw new AppErrors.AppError("request.validation_failed", {
      cause,
      public_details: { action: "workspace_script" },
      diagnostic_context: { reason: "agent_workspace_invalid_change_file" },
    });
  }
}

/** 所有可修复 change 错误都引导模型回到 workspace_script。 */
function change_validation_error(reason: string): AppErrors.AppError {
  return new AppErrors.AppError("request.validation_failed", {
    public_details: { action: "workspace_script" },
    diagnostic_context: { reason },
  });
}
