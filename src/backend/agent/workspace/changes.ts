import path from "node:path";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import { PROMPT_KINDS, type PromptKind } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import * as AppErrors from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import { iterate_utf8_lf_lines } from "../../../shared/utils/text-tool";
import type { NativeFs } from "../../../native/native-fs";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS,
  AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  is_agent_workspace_manual_status,
} from "./contract";
import {
  AGENT_WORKSPACE_FP_LENGTH,
  create_empty_agent_workspace_intent_batch,
  type AgentWorkspaceIntentBatch,
  type AgentWorkspaceItemUpdateIntent,
  type AgentWorkspacePromptUpdateIntent,
  type AgentWorkspaceQualityCreateIntent,
  type AgentWorkspaceQualityDeleteIntent,
  type AgentWorkspaceQualityUpdateIntent,
  type AgentWorkspaceRejectedChange,
  type AgentWorkspaceRejectionReason,
} from "../../project/agent-workspace-write";

export type ParsedAgentWorkspaceChanges = Readonly<{
  batch: AgentWorkspaceIntentBatch;
  rejected: AgentWorkspaceRejectedChange[];
}>;
type ParsedRow = { line: number; value: JsonRecord };
type Parsed<T> = { intent: T } | { rejection: AgentWorkspaceRejectedChange };

/** 逐行收窄固定 change 文件；坏行进入 rejected，合法意图继续参与同批处理。 */
export async function prepare_agent_workspace_changes(args: {
  nativeFs: NativeFs;
  workspacePath: string;
}): Promise<ParsedAgentWorkspaceChanges> {
  const empty = create_empty_agent_workspace_intent_batch();
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const item_rows = await read_change_rows(
    args.nativeFs,
    path.join(args.workspacePath, AGENT_WORKSPACE_CHANGE_PATHS.items.updates),
  );
  const prompt_rows = await read_change_rows(
    args.nativeFs,
    path.join(args.workspacePath, AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates),
  );
  const items: AgentWorkspaceItemUpdateIntent[] = [];
  for (const row of item_rows) {
    const parsed = parse_item(row.value, row.line);
    if ("rejection" in parsed) rejected.push(parsed.rejection);
    else items.push(parsed.intent);
  }
  const prompts: AgentWorkspacePromptUpdateIntent[] = [];
  for (const row of prompt_rows) {
    const parsed = parse_prompt(row.value, row.line);
    if ("rejection" in parsed) rejected.push(parsed.rejection);
    else prompts.push(parsed.intent);
  }
  const quality = { ...empty.quality };
  for (const kind of QUALITY_RULE_KINDS) {
    const creates: AgentWorkspaceQualityCreateIntent[] = [],
      updates: AgentWorkspaceQualityUpdateIntent[] = [],
      deletes: AgentWorkspaceQualityDeleteIntent[] = [];
    for (const operation of AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS) {
      const rows = await read_change_rows(
        args.nativeFs,
        path.join(args.workspacePath, AGENT_WORKSPACE_CHANGE_PATHS[kind][operation]),
      );
      for (const row of rows) {
        if (operation === "creates") {
          const parsed = parse_create(kind, row.value, row.line);
          if ("rejection" in parsed) rejected.push(parsed.rejection);
          else creates.push(parsed.intent);
        } else if (operation === "updates") {
          const parsed = parse_update(kind, row.value, row.line);
          if ("rejection" in parsed) rejected.push(parsed.rejection);
          else updates.push(parsed.intent);
        } else {
          const parsed = parse_delete(kind, row.value, row.line);
          if ("rejection" in parsed) rejected.push(parsed.rejection);
          else deletes.push(parsed.intent);
        }
      }
    }
    quality[kind] = { creates, updates, deletes };
  }
  return { batch: { items, prompts, quality }, rejected };
}

/** item 行只投影真实出现的可写字段。 */
function parse_item(value: JsonRecord, line: number): Parsed<AgentWorkspaceItemUpdateIntent> {
  if (!exact(value, ["item_id", "fp", ...AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS]))
    return { rejection: reject("items", "update", line, "invalid_change") };
  const item_id = value["item_id"],
    fp = value["fp"];
  if (!positive(item_id) || !fp_ok(fp))
    return { rejection: reject("items", "update", line, "invalid_change", item_id) };
  const update: Record<string, unknown> = {};
  for (const field of AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const field_value = value[field];
    if (
      field === "status"
        ? !is_agent_workspace_manual_status(field_value)
        : typeof field_value !== "string"
    )
      return { rejection: reject("items", "update", line, "invalid_change", item_id) };
    update[field] = field_value;
  }
  return Object.keys(update).length === 0
    ? { rejection: reject("items", "update", line, "invalid_change", item_id) }
    : { intent: { line, item_id, fp, update } as AgentWorkspaceItemUpdateIntent };
}

/** prompt 行固定包含 kind、基线 fp 与完整新正文。 */
function parse_prompt(value: JsonRecord, line: number): Parsed<AgentWorkspacePromptUpdateIntent> {
  const kind = value["kind"],
    fp = value["fp"],
    text = value["text"];
  if (
    !exact(value, ["kind", "fp", "text"]) ||
    typeof kind !== "string" ||
    !(PROMPT_KINDS as readonly string[]).includes(kind) ||
    !fp_ok(fp) ||
    typeof text !== "string"
  )
    return { rejection: prompt_rejection(kind, line) };
  return { intent: { line, kind: kind as PromptKind, fp, text } };
}

/** quality create 要求完整业务字段和明确排序意图。 */
function parse_create(
  kind: QualityRuleKind,
  value: JsonRecord,
  line: number,
): Parsed<AgentWorkspaceQualityCreateIntent> {
  const fields = AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind];
  if (
    !exact(value, [...fields, "sort"]) ||
    !valid_sort(value["sort"]) ||
    !valid_fields(value, fields)
  )
    return { rejection: quality_create_rejection(kind, value, line) };
  return {
    intent: {
      line,
      kind,
      fields: Object.fromEntries(fields.map((field) => [field, value[field]])),
      sort: value["sort"] as number,
    },
  };
}

/** quality update 至少改变一个业务字段或排序位置。 */
function parse_update(
  kind: QualityRuleKind,
  value: JsonRecord,
  line: number,
): Parsed<AgentWorkspaceQualityUpdateIntent> {
  const fields = AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind],
    id = value["id"],
    fp = value["fp"];
  if (!exact(value, ["id", "fp", ...fields, "sort"]) || typeof id !== "string" || !fp_ok(fp))
    return { rejection: reject("quality", "update", line, "invalid_change", id, kind) };
  const present = fields.filter((field) => Object.hasOwn(value, field));
  if (present.length === 0 && !Object.hasOwn(value, "sort"))
    return { rejection: reject("quality", "update", line, "invalid_change", id, kind) };
  if (!valid_fields(value, present) || (Object.hasOwn(value, "sort") && !valid_sort(value["sort"])))
    return { rejection: reject("quality", "update", line, "invalid_change", id, kind) };
  return {
    intent: {
      line,
      kind,
      id,
      fp,
      fields: Object.fromEntries(present.map((field) => [field, value[field]])),
      ...(Object.hasOwn(value, "sort") ? { sort: value["sort"] as number } : {}),
    },
  };
}

/** quality delete 只携带既有对象身份与基线 fp。 */
function parse_delete(
  kind: QualityRuleKind,
  value: JsonRecord,
  line: number,
): Parsed<AgentWorkspaceQualityDeleteIntent> {
  if (!exact(value, ["id", "fp"]) || typeof value["id"] !== "string" || !fp_ok(value["fp"]))
    return { rejection: reject("quality", "delete", line, "invalid_change", value["id"], kind) };
  return { intent: { line, kind, id: value["id"], fp: value["fp"] } };
}

/** 按共享领域字段名收窄字符串与布尔值。 */
function valid_fields(value: JsonRecord, fields: readonly string[]): boolean {
  return fields.every(
    (field) =>
      Object.hasOwn(value, field) &&
      (field === "regex" || field === "case_sensitive"
        ? typeof value[field] === "boolean"
        : typeof value[field] === "string"),
  );
}
/** 允许字段集合必须覆盖当前对象的全部键且至少命中一个键。 */
function exact(value: JsonRecord, fields: readonly string[]): boolean {
  return (
    Object.keys(value).every((field) => fields.includes(field)) &&
    fields.some((field) => Object.hasOwn(value, field))
  );
}
/** item 身份使用正整数。 */
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
/** change 只接受运行时 contract 声明的定长 Base64URL fp。 */
function fp_ok(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === AGENT_WORKSPACE_FP_LENGTH &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}
/** -1 表示追加，其余值是零基插入位置。 */
function valid_sort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= -1;
}

/** 保留物理行号，单行解析错误不会中断同批其它意图。 */
async function read_change_rows(native_fs: NativeFs, file_path: string): Promise<ParsedRow[]> {
  if (!native_fs.exists(file_path)) throw new AppErrors.AppError("runtime.internal_invariant");
  if (native_fs.stat(file_path).size === 0) return [];
  const rows: ParsedRow[] = [];
  let line = 0;
  for await (const text of iterate_utf8_lf_lines(native_fs.create_read_stream(file_path))) {
    line += 1;
    if (text.trim() === "") continue;
    try {
      const parsed = JsonTool.parseStrict(text);
      rows.push({ line, value: is_json_record(parsed) ? parsed : { __invalid_line__: true } });
    } catch {
      rows.push({ line, value: { __invalid_line__: true } });
    }
  }
  return rows;
}

/** 为 item 与既有 quality 对象生成最短稳定身份。 */
function reject(
  scope: "items" | "quality" | "prompts",
  op: "create" | "update" | "delete",
  line: number,
  reason: AgentWorkspaceRejectionReason,
  id?: unknown,
  kind?: unknown,
): AgentWorkspaceRejectedChange {
  return {
    scope,
    op,
    ...(typeof kind === "string" ? { kind } : {}),
    ...(typeof id === "string" || typeof id === "number" ? { id } : {}),
    ...(id === undefined && kind === undefined ? { line } : {}),
    reason,
  } as AgentWorkspaceRejectedChange;
}

/** prompt 只在 kind 合法时暴露 kind，否则使用行号定位输入。 */
function prompt_rejection(kind: unknown, line: number): AgentWorkspaceRejectedChange {
  return {
    scope: "prompts",
    op: "update",
    ...(typeof kind === "string" && (PROMPT_KINDS as readonly string[]).includes(kind)
      ? { kind }
      : { line }),
    reason: "invalid_change",
  };
}

/** create 尚无稳定 id，优先使用业务 src，缺失时回退到文件行号。 */
function quality_create_rejection(
  kind: QualityRuleKind,
  value: JsonRecord,
  line: number,
): AgentWorkspaceRejectedChange {
  return {
    scope: "quality",
    kind,
    op: "create",
    ...(typeof value["src"] === "string" && value["src"] !== "" ? { src: value["src"] } : { line }),
    reason: "invalid_change",
  };
}
