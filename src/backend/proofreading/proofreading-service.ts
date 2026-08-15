import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectWriteStore } from "../project/project-write-store";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import {
  require_project_expected_section_revisions,
  type ProjectExpectedSectionRevisions,
  type ProjectItemWriteChange,
} from "../project/project-write-request";
import { Item } from "../../domain/item";
import { is_json_record } from "../../domain/json";
import type { ProjectChangeItemsPayload, ProjectWriteResult } from "../../shared/project-event";
import { read_item_name_text } from "../../shared/item-name";
import { clear_item_translation_fields } from "../../shared/item-text";
import type { ProjectItemWriteFields } from "../../shared/project/project-item-field-patch";
import { compile_text_pattern, replace_text_pattern } from "../../shared/text/text-pattern";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  type ProofreadingManualStatusCode,
} from "../../shared/proofreading/proofreading-types";
import * as AppErrors from "../../shared/error";
import {
  apply_proofreading_item_update,
  are_proofreading_item_write_fields_equal,
  type ProofreadingItemUpdateFields,
} from "./proofreading-item-update";

type ProofreadingItemUpdate = ProofreadingItemUpdateFields & {
  item_id: number;
};

const MAX_PROOFREADING_ITEM_UPDATES = 500;
const DEFAULT_PROOFREADING_UPDATE_SOURCE = "proofreading_apply_item_changes";

/**
 * 承载校对同步写入口，把客户端命令转换为后端项目事实。
 */
export class ProofreadingService {
  private readonly database: ProjectDatabase; // 校对同步保存直接写 .lg，但仍只能通过 ProjectDatabase workflow 触达数据库

  private readonly runtime_gate: RuntimeOperationGate; // 用户与 Agent 写入口共享串行门禁

  private readonly session_state: ProjectSessionState; // 校对同步写入口只以公开会话状态定位当前工程

  private readonly write_store: ProjectWriteStore; // 校对只提交业务补丁，事务和事件统一由 ProjectWriteStore 完成

  /**
   * 注入数据库与运行时桥，保证写库和读侧缓存同步都可被测试替换
   */
  public constructor(
    database: ProjectDatabase,
    runtime_gate: RuntimeOperationGate,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
  ) {
    this.database = database;
    this.runtime_gate = runtime_gate;
    this.session_state = session_state;
    this.write_store = write_store;
  }

  /**
   * 批量更新正文与姓名译文，整批事实在同一项目写租约和事务内提交。
   */
  public async apply_item_changes(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(
      async () =>
        await this.apply_item_changes_under_lease(request, DEFAULT_PROOFREADING_UPDATE_SOURCE),
    );
  }

  /** 在项目写租约内构造最终 item 事实，并保留调用方来源到提交事件。 */
  private async apply_item_changes_under_lease(
    request: JsonRecord,
    source: string,
  ): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const expected_section_revisions = this.prepare_write_context(request);
    const updates = this.normalize_item_updates(request["changes"]);
    const current_by_id = this.get_item_write_facts_by_ids(
      project_path,
      updates.map((update) => update.item_id),
    );
    const changes: ProjectItemWriteChange[] = [];
    for (const update of updates) {
      const current = current_by_id.get(update.item_id);
      if (current === undefined) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "item_not_found", item_id: update.item_id },
        });
      }
      const next = apply_proofreading_item_update(current, update);
      if (!are_proofreading_item_write_fields_equal(current, next)) {
        changes.push({ item_id: update.item_id, current, next });
      }
    }
    return await this.persist_changed_items(
      project_path,
      expected_section_revisions,
      {
        changes,
        items_payload: {
          payloadMode: "canonical-delta",
          changedIds: changes.map((change) => change.item_id),
        },
      },
      source,
    );
  }

  /**
   * 批量替换在后端编译文本模式，避免渲染进程提交替换后的最终事实
   */
  public async replace_all(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(
      async () => await this.replace_all_under_lease(request),
    );
  }

  /** 在项目写租约内按后端当前事实执行批量替换。 */
  private async replace_all_under_lease(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const expected_section_revisions = this.prepare_write_context(request);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const pattern = compile_text_pattern({
      source_text: String(request["search_text"] ?? ""),
      mode: (request["is_regex"] ?? false) ? "regex" : "literal",
      case_sensitive: false,
      global: true,
      trim: false,
    });
    if (pattern === null) {
      return { accepted: true, changes: [] };
    }
    const current_by_id = this.get_items_by_ids(project_path, item_ids);
    const changes: ProjectItemWriteChange[] = [];
    for (const item_id of item_ids) {
      const item = current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      let next_item = item;
      const dst_replace_result = replace_text_pattern({
        text: String(item["dst"] ?? ""),
        pattern,
        replacement_text: String(request["replace_text"] ?? ""),
        replacement_syntax: (request["is_regex"] ?? false) ? "javascript" : "literal",
      });
      if (dst_replace_result.count > 0 && dst_replace_result.text !== item["dst"]) {
        next_item = apply_proofreading_item_update(next_item, {
          dst: dst_replace_result.text,
        });
      }

      const current_name_dst = read_item_name_text(item["name_dst"]);
      const name_replace_result = replace_text_pattern({
        text: current_name_dst,
        pattern,
        replacement_text: String(request["replace_text"] ?? ""),
        replacement_syntax: (request["is_regex"] ?? false) ? "javascript" : "literal",
      });
      if (name_replace_result.count > 0 && name_replace_result.text !== current_name_dst) {
        next_item = apply_proofreading_item_update(next_item, {
          name_dst: name_replace_result.text,
        });
      }

      if (are_proofreading_item_write_fields_equal(item, next_item)) {
        continue;
      }
      changes.push({ item_id, current: item, next: next_item });
    }
    return await this.persist_changed_items(project_path, expected_section_revisions, {
      changes,
      items_payload: {
        payloadMode: "canonical-delta",
        changedIds: changes.map((change) => change.item_id),
      },
    });
  }

  /**
   * 批量清空译文同时清空正文和姓名译文，保留 status 和 retry_count 供用户手动判定
   */
  public async clear_translations(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(
      async () => await this.clear_translations_under_lease(request),
    );
  }

  /** 在项目写租约内筛出实际含译文的目标并提交统一字段补丁。 */
  private async clear_translations_under_lease(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const expected_section_revisions = this.prepare_write_context(request);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const current_by_id = this.get_item_write_facts_by_ids(project_path, item_ids);
    const changes: ProjectItemWriteChange[] = [];
    for (const item_id of item_ids) {
      const item = current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      const next_item = clear_item_translation_fields(item);
      if (are_proofreading_item_write_fields_equal(item, next_item)) {
        continue;
      }
      changes.push({ item_id, current: item, next: next_item });
    }
    if (changes.length === 0) {
      return { accepted: true, changes: [] };
    }
    return await this.write_store.apply_proofreading_item_patch({
      projectPath: project_path,
      expectedSectionRevisions: expected_section_revisions,
      source: DEFAULT_PROOFREADING_UPDATE_SOURCE,
      changes,
      fieldPatch: { dst: "", name_dst: null },
    });
  }

  /**
   * 校对写入起手必须先校验 revision，再读取当前数据库事实
   */
  private prepare_write_context(request: JsonRecord): ProjectExpectedSectionRevisions {
    this.assert_no_legacy_fields(request, ["items", "translation_extras"]);
    return require_project_expected_section_revisions(request["expected_section_revisions"]);
  }

  /**
   * 旧最终事实载荷字段出现时直接拒绝，确保校对事实只由后端生成
   */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (field in request) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "legacy_payload_field", field },
        });
      }
    }
  }

  /**
   * 写入变更 item，并按状态增量更新翻译统计，避免校对热路径扫描全量条目。
   */
  private async persist_changed_items(
    project_path: string,
    expected_section_revisions: ProjectExpectedSectionRevisions,
    args: {
      changes: ProjectItemWriteChange[];
      items_payload: Pick<
        ProjectChangeItemsPayload,
        "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
      >;
    },
    source = DEFAULT_PROOFREADING_UPDATE_SOURCE,
  ): Promise<ProjectWriteResult> {
    if (args.changes.length === 0) {
      return { accepted: true, changes: [] };
    }
    return await this.write_store.apply_proofreading_bulk_patch({
      projectPath: project_path,
      expectedSectionRevisions: expected_section_revisions,
      source,
      changes: args.changes,
      itemsPayload: args.items_payload,
    });
  }

  /**
   * 公开 item_ids 去重并保持顺序，坏 id 在命令边界丢弃
   */
  private normalize_item_ids(value: JsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const item_ids: number[] = [];
    const seen = new Set<number>();
    for (const raw_item_id of value) {
      const item_id = this.parse_integer_like(raw_item_id);
      if (item_id === null || item_id <= 0 || seen.has(item_id)) {
        continue;
      }
      seen.add(item_id);
      item_ids.push(item_id);
    }
    return item_ids;
  }

  /**
   * item 更新命令必须非空、字段已知、ID 唯一且每项至少包含一个可写字段。
   */
  private normalize_item_updates(value: JsonValue | undefined): ProofreadingItemUpdate[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > MAX_PROOFREADING_ITEM_UPDATES
    ) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "invalid_proofreading_item_updates" },
      });
    }
    const updates: ProofreadingItemUpdate[] = [];
    const item_ids = new Set<number>();
    for (const raw_update of value) {
      if (!is_json_record(raw_update)) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "invalid_proofreading_item_update" },
        });
      }
      const item_id = this.parse_integer_or_throw(raw_update["item_id"]);
      if (item_id <= 0 || item_ids.has(item_id)) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "duplicate_or_invalid_item_id", item_id },
        });
      }
      const has_dst = Object.hasOwn(raw_update, "dst");
      const has_name_dst = Object.hasOwn(raw_update, "name_dst");
      const has_status = Object.hasOwn(raw_update, "status");
      const unknown_field = Object.keys(raw_update).find(
        (field) => !["item_id", "dst", "name_dst", "status"].includes(field),
      );
      if (unknown_field !== undefined) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: {
            reason: "unknown_proofreading_item_update_field",
            item_id,
            field: unknown_field,
          },
        });
      }
      if (!has_dst && !has_name_dst && !has_status) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "empty_proofreading_item_update", item_id },
        });
      }
      if (
        (has_dst && typeof raw_update["dst"] !== "string") ||
        (has_name_dst && typeof raw_update["name_dst"] !== "string")
      ) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "invalid_proofreading_translation_field", item_id },
        });
      }
      item_ids.add(item_id);
      updates.push({
        item_id,
        ...(has_dst ? { dst: raw_update["dst"] as string } : {}),
        ...(has_name_dst ? { name_dst: raw_update["name_dst"] as string } : {}),
        ...(has_status ? { status: this.parse_manual_status_or_throw(raw_update["status"]) } : {}),
      });
    }
    return updates;
  }

  /**
   * 按目标 id 读取当前 item 事实，校对批量操作不再预热全量 items。
   */
  private get_items_by_ids(
    project_path: string,
    item_ids: number[],
  ): Map<number, MutableJsonRecord & ProjectItemWriteFields> {
    const items_by_id = new Map<number, MutableJsonRecord & ProjectItemWriteFields>();
    const value = this.database.get_items_by_ids(project_path, item_ids);
    if (!Array.isArray(value)) {
      return items_by_id;
    }
    for (const item of value) {
      if (!is_json_record(item)) {
        continue;
      }
      const item_id = this.parse_integer_like(item["id"]);
      if (item_id === null || item_id <= 0) {
        continue;
      }
      items_by_id.set(item_id, {
        ...item,
        id: item_id,
        dst: String(item["dst"] ?? ""),
        name_dst: Item.normalize_name_field(item["name_dst"]),
        status: String(item["status"] ?? ""),
        retry_count: Number(item["retry_count"] ?? 0),
      });
    }
    return items_by_id;
  }

  /**
   * 读取校对字段 patch 所需的窄行事实，避免批量状态操作解析完整 item JSON。
   */
  private get_item_write_facts_by_ids(
    project_path: string,
    item_ids: number[],
  ): Map<number, ProjectItemWriteFields> {
    const items_by_id = new Map<number, ProjectItemWriteFields>();
    const value = this.database.get_item_write_facts_by_ids(project_path, item_ids);
    if (!Array.isArray(value)) {
      return items_by_id;
    }
    for (const item of value) {
      if (!is_json_record(item)) {
        continue;
      }
      const item_id = this.parse_integer_like(item["id"]);
      if (item_id === null || item_id <= 0) {
        continue;
      }
      items_by_id.set(item_id, {
        dst: String(item["dst"] ?? ""),
        name_dst: Item.normalize_name_field(item["name_dst"]),
        status: String(item["status"] ?? ""),
        retry_count: Number(item["retry_count"] ?? 0),
      });
    }
    return items_by_id;
  }

  /**
   * 人工状态菜单只暴露三种可写状态，其它计算状态不能从校对页直接写入
   */
  private parse_manual_status_or_throw(value: JsonValue | undefined): ProofreadingManualStatusCode {
    if (
      typeof value === "string" &&
      (PROOFREADING_MANUAL_STATUS_CODES as readonly string[]).includes(value)
    ) {
      return value as ProofreadingManualStatusCode;
    }

    throw new AppErrors.AppError("request.validation_failed", {
      diagnostic_context: {
        reason: "invalid_proofreading_manual_status",
        status: value,
      },
    });
  }

  /**
   * item_id 命令字段使用严格转换，转换失败时保持请求失败语义
   */
  private parse_integer_or_throw(value: JsonValue | undefined): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    return parsed;
  }

  /**
   * item_id 只接受整数数字或整数字符串，拒绝布尔值和小数兼容
   */
  private parse_integer_like(value: JsonValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[+-]?\d+$/.test(trimmed)) {
        const parsed = Number(trimmed);
        return Number.isSafeInteger(parsed) ? parsed : null;
      }
    }
    return null;
  }
}
