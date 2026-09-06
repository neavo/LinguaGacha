import path from "node:path";

import { Check } from "typebox/value";
import type { TSchema } from "@earendil-works/pi-ai";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import { PROMPT_KINDS } from "../../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import * as AppErrors from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import { iterate_utf8_lf_lines } from "../../../shared/utils/text-tool";
import type { NativeFs } from "../../../native/native-fs";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
} from "./contract";
import {
  create_empty_agent_workspace_intent_batch,
  type AgentWorkspaceIntentBatch,
  type AgentWorkspaceItemUpdateIntent,
  type AgentWorkspacePromptUpdateIntent,
  type AgentWorkspaceQualityCreateIntent,
  type AgentWorkspaceQualityDeleteIntent,
  type AgentWorkspaceQualityUpdateIntent,
  type AgentWorkspaceRejectedChange,
} from "../../project/agent-workspace-write";

import {
  AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA,
  AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA,
  AGENT_WORKSPACE_QUALITY_SCHEMAS,
} from "./schema";
import { describe_agent_workspace_schema_error } from "./validation";

export type ParsedAgentWorkspaceChanges = Readonly<{
  batch: AgentWorkspaceIntentBatch;
  rejected: AgentWorkspaceRejectedChange[];
}>;

type ParsedRow = { line: number; value: JsonRecord; error?: string };
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
    const parsed = parse_item(row);
    if ("rejection" in parsed) rejected.push(parsed.rejection);
    else items.push(parsed.intent);
  }
  const prompts: AgentWorkspacePromptUpdateIntent[] = [];
  for (const row of prompt_rows) {
    const parsed = parse_prompt(row);
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
          const parsed = parse_create(kind, row);
          if ("rejection" in parsed) rejected.push(parsed.rejection);
          else creates.push(parsed.intent);
        } else if (operation === "updates") {
          const parsed = parse_update(kind, row);
          if ("rejection" in parsed) rejected.push(parsed.rejection);
          else updates.push(parsed.intent);
        } else {
          const parsed = parse_delete(kind, row);
          if ("rejection" in parsed) rejected.push(parsed.rejection);
          else deletes.push(parsed.intent);
        }
      }
    }
    quality[kind] = { creates, updates, deletes };
  }
  return { batch: { items, prompts, quality }, rejected };
}

/** Schema 负责记录结构，解析器只把合法记录转换为领域意图。 */
function parse_item(row: ParsedRow): Parsed<AgentWorkspaceItemUpdateIntent> {
  const { value, line } = row;
  if (!Check(AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA, value))
    return {
      rejection: invalid_change(AGENT_WORKSPACE_ITEM_UPDATE_SCHEMA, row, "items", "update"),
    };
  const { item_id, fp, ...update } = value;
  return { intent: { line, item_id, fp, update } };
}

/** prompt 更新携带完整正文；合法 kind 同时用于失败定位。 */
function parse_prompt(row: ParsedRow): Parsed<AgentWorkspacePromptUpdateIntent> {
  const { value, line } = row;
  if (!Check(AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA, value))
    return {
      rejection: invalid_change(AGENT_WORKSPACE_PROMPT_UPDATE_SCHEMA, row, "prompts", "update"),
    };
  return { intent: { line, kind: value.kind, fp: value.fp, text: value.text } };
}

/** 新规则拆出排序意图，业务字段交由项目写入器归一。 */
function parse_create(
  kind: QualityRuleKind,
  row: ParsedRow,
): Parsed<AgentWorkspaceQualityCreateIntent> {
  const { value, line } = row;
  const schema = AGENT_WORKSPACE_QUALITY_SCHEMAS[kind].creates;
  if (!Check(schema, value))
    return {
      rejection: invalid_change(schema, row, "quality", "create", kind),
    };
  const { sort, ...fields } = value;
  return { intent: { line, kind, sort, fields } };
}

/** 既有规则只投影实际提供的业务字段和排序意图。 */
function parse_update(
  kind: QualityRuleKind,
  row: ParsedRow,
): Parsed<AgentWorkspaceQualityUpdateIntent> {
  const { value, line } = row;
  const schema = AGENT_WORKSPACE_QUALITY_SCHEMAS[kind].updates;
  if (!Check(schema, value))
    return {
      rejection: invalid_change(schema, row, "quality", "update", kind),
    };
  const { id, fp, sort, ...fields } = value;
  return { intent: { line, kind, id, fp, fields, ...(sort === undefined ? {} : { sort }) } };
}

/** 删除意图只携带规则身份与当前指纹。 */
function parse_delete(
  kind: QualityRuleKind,
  row: ParsedRow,
): Parsed<AgentWorkspaceQualityDeleteIntent> {
  const { value, line } = row;
  const schema = AGENT_WORKSPACE_QUALITY_SCHEMAS[kind].deletes;
  if (!Check(schema, value))
    return {
      rejection: invalid_change(schema, row, "quality", "delete", kind),
    };
  return { intent: { line, kind, id: value.id, fp: value.fp } };
}

/** 物理行号与字段路径使同一对象的多行错误也能独立修复。 */
function invalid_change(
  schema: TSchema,
  row: ParsedRow,
  scope: AgentWorkspaceRejectedChange["scope"],
  op: AgentWorkspaceRejectedChange["op"],
  quality_kind?: QualityRuleKind,
): AgentWorkspaceRejectedChange {
  const id = row.value[scope === "items" ? "item_id" : "id"];
  const src = row.value["src"];
  const kind =
    scope === "prompts" ? PROMPT_KINDS.find((kind) => kind === row.value["kind"]) : quality_kind;
  const error =
    row.error === undefined
      ? describe_agent_workspace_schema_error(schema, row.value)
      : { path: "/", message: row.error };
  return {
    scope,
    op,
    reason: "invalid_change",
    line: row.line,
    ...(kind === undefined ? {} : { kind }),
    ...(scope !== "prompts" && op !== "create" && (typeof id === "string" || typeof id === "number")
      ? { id }
      : {}),
    ...(op === "create" && typeof src === "string" && src !== "" ? { src } : {}),
    ...error,
  };
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
      rows.push(
        is_json_record(parsed)
          ? { line, value: parsed }
          : { line, value: {}, error: "Each change line must contain a JSON object." },
      );
    } catch {
      rows.push({ line, value: {}, error: "Change line contains invalid JSON." });
    }
  }
  return rows;
}
