import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectWriteStore } from "../project/project-write-store";
import type { ProjectOperationGate } from "../project/project-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import {
  require_project_expected_section_revisions,
  type ProjectExpectedSectionRevisions,
} from "../project/project-write-request";
import { Item, type ItemStatus } from "../../domain/item";
import { is_json_record } from "../../domain/json";
import type {
  ProjectChangeItemFieldPatch,
  ProjectChangeItemsPayload,
  ProjectWriteResult,
} from "../../shared/project-event";
import {
  are_item_name_fields_equal,
  read_item_name_text,
  write_item_name_text,
} from "../../shared/item-name";
import { clear_item_translation_fields } from "../../shared/item-text";
import { compile_text_pattern, replace_text_pattern } from "../../shared/text/text-pattern";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  type ProofreadingManualStatusCode,
} from "../../shared/proofreading/proofreading-types";
import * as AppErrors from "../../shared/error";

type ProofreadingItemChange = {
  current: MutableJsonRecord; // 数据库提交前的行事实，用于计算统计增量
  next: MutableJsonRecord; // 数据库将要写入的最终行事实
};

type ProofreadingItemUpdate = {
  item_id: number;
  dst?: string;
  name_dst?: string;
};

const MAX_PROOFREADING_ITEM_UPDATES = 500;
const DEFAULT_PROOFREADING_UPDATE_SOURCE = "proofreading_update_items";

/**
 * 承载校对同步写入口，把渲染进程命令转换为 Electron main 数据库事实
 */
export class ProofreadingService {
  private readonly database: ProjectDatabase; // 校对同步保存直接写 .lg，但仍只能通过 ProjectDatabase workflow 触达数据库

  private readonly project_operation_gate: ProjectOperationGate; // 人工校对与翻译任务不能同时改写 item

  private readonly session_state: ProjectSessionState; // 校对同步写入口只以 公开会话状态定位当前工程

  private readonly write_store: ProjectWriteStore; // 校对只提交业务补丁，事务和事件统一由 ProjectWriteStore 完成

  /**
   * 注入数据库与运行时桥，保证写库和读侧缓存同步都可被测试替换
   */
  public constructor(
    database: ProjectDatabase,
    project_operation_gate: ProjectOperationGate,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
  ) {
    this.database = database;
    this.project_operation_gate = project_operation_gate;
    this.session_state = session_state;
    this.write_store = write_store;
  }

  /**
   * 批量更新正文与姓名译文，整批事实在同一项目写租约和事务内提交。
   */
  public async update_items(
    request: JsonRecord,
    source = DEFAULT_PROOFREADING_UPDATE_SOURCE,
  ): Promise<ProjectWriteResult> {
    return await this.project_operation_gate.run_exclusive_project_write(
      async () => await this.update_items_under_lease(request, source),
    );
  }

  /** 在项目写租约内构造最终 item 事实，并保留调用方来源到提交事件。 */
  private async update_items_under_lease(
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
    const changes: ProofreadingItemChange[] = [];
    let update_translation_extras = false;
    for (const update of updates) {
      const current = current_by_id.get(update.item_id);
      if (current === undefined) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "item_not_found", item_id: update.item_id },
        });
      }
      let next = current;
      if (update.dst !== undefined) {
        next = this.apply_manual_dst(next, update.dst);
        update_translation_extras ||=
          String(current["dst"] ?? "") !== update.dst || current["status"] !== next["status"];
      }
      if (update.name_dst !== undefined) {
        next = this.apply_manual_name_dst(next, update.name_dst);
      }
      if (!this.are_items_equal(current, next)) {
        changes.push({ current, next });
      }
    }
    return await this.persist_changed_items(
      project_path,
      expected_section_revisions,
      {
        changes,
        items_payload: {
          payloadMode: "canonical-delta",
          changedIds: this.collect_item_ids(changes.map((change) => change.next)),
        },
        update_translation_extras,
      },
      source,
    );
  }

  /**
   * 批量替换在后端编译文本模式，避免渲染进程提交替换后的最终事实
   */
  public async replace_all(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.project_operation_gate.run_exclusive_project_write(
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
    const changes: ProofreadingItemChange[] = [];
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
        next_item = this.apply_manual_dst(next_item, dst_replace_result.text);
      }

      const current_name_dst = read_item_name_text(item["name_dst"]);
      const name_replace_result = replace_text_pattern({
        text: current_name_dst,
        pattern,
        replacement_text: String(request["replace_text"] ?? ""),
        replacement_syntax: (request["is_regex"] ?? false) ? "javascript" : "literal",
      });
      if (name_replace_result.count > 0 && name_replace_result.text !== current_name_dst) {
        next_item = this.apply_manual_name_dst(next_item, name_replace_result.text);
      }

      if (this.are_items_equal(item, next_item)) {
        continue;
      }
      changes.push({ current: item, next: next_item });
    }
    return await this.persist_changed_items(project_path, expected_section_revisions, {
      changes,
      items_payload: {
        payloadMode: "canonical-delta",
        changedIds: this.collect_item_ids(changes.map((change) => change.next)),
      },
      update_translation_extras: true,
    });
  }

  /**
   * 批量清空译文同时清空正文和姓名译文，保留 status 和 retry_count 供用户手动判定
   */
  public async clear_translations(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.project_operation_gate.run_exclusive_project_write(
      async () => await this.clear_translations_under_lease(request),
    );
  }

  /** 在项目写租约内筛出实际含译文的目标并提交统一字段补丁。 */
  private async clear_translations_under_lease(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const expected_section_revisions = this.prepare_write_context(request);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const current_by_id = this.get_item_write_facts_by_ids(project_path, item_ids);
    const changes: ProofreadingItemChange[] = [];
    for (const item_id of item_ids) {
      const item = current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      const next_item = clear_item_translation_fields(item);
      if (this.are_items_equal(item, next_item)) {
        continue;
      }
      changes.push({ current: item, next: next_item });
    }
    return await this.persist_field_patch_items(project_path, expected_section_revisions, {
      changes,
      field_patch: { dst: "", name_dst: null },
      update_translation_extras: false,
    });
  }

  /**
   * 批量设置状态只接受人工可写状态集合，并把旧重试计数从新状态事实中清掉
   */
  public async set_translation_status(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.project_operation_gate.run_exclusive_project_write(
      async () => await this.set_translation_status_under_lease(request),
    );
  }

  /** 在项目写租约内归一人工状态，并同步清除旧重试计数。 */
  private async set_translation_status_under_lease(
    request: JsonRecord,
  ): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const expected_section_revisions = this.prepare_write_context(request);
    const next_status = this.parse_manual_status_or_throw(request["status"]);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const current_by_id = this.get_item_write_facts_by_ids(project_path, item_ids);
    const changes: ProofreadingItemChange[] = [];
    for (const item_id of item_ids) {
      const item = current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      const next_item = {
        ...item,
        status: next_status,
        retry_count: 0,
      };
      if (this.are_items_equal(item, next_item)) {
        continue;
      }
      changes.push({ current: item, next: next_item });
    }
    return await this.persist_field_patch_items(project_path, expected_section_revisions, {
      changes,
      field_patch: {
        status: next_status,
        retry_count: 0,
      },
      update_translation_extras: true,
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
        throw new AppErrors.RequestValidationError({
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
      changes: ProofreadingItemChange[];
      items_payload: Pick<
        ProjectChangeItemsPayload,
        "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
      >;
      update_translation_extras: boolean;
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
      updateTranslationExtras: args.update_translation_extras,
    });
  }

  /**
   * 统一字段 patch 走数据库 JSON 局部写入，避免为校对批量操作构造完整 item DTO。
   */
  private async persist_field_patch_items(
    project_path: string,
    expected_section_revisions: ProjectExpectedSectionRevisions,
    args: {
      changes: ProofreadingItemChange[];
      field_patch: ProjectChangeItemFieldPatch;
      update_translation_extras: boolean;
    },
  ): Promise<ProjectWriteResult> {
    if (args.changes.length === 0) {
      return { accepted: true, changes: [] };
    }
    return await this.write_store.apply_proofreading_item_patch({
      projectPath: project_path,
      expectedSectionRevisions: expected_section_revisions,
      source: DEFAULT_PROOFREADING_UPDATE_SOURCE,
      changes: args.changes,
      fieldPatch: args.field_patch,
      updateTranslationExtras: args.update_translation_extras,
    });
  }

  /**
   * 手动写入译文后由后端统一决定 status，不接受渲染进程提交 status 事实
   */
  private apply_manual_dst(item: MutableJsonRecord, next_dst: string): MutableJsonRecord {
    return {
      ...item,
      dst: next_dst,
      status: next_dst === "" ? this.normalize_item_status(item["status"]) : "PROCESSED",
    };
  }

  /**
   * 只改写共享名称字段的首个可编辑槽，保留既有数组形状和其余名称。
   */
  private apply_manual_name_dst(item: MutableJsonRecord, next_name_dst: string): MutableJsonRecord {
    return Item.from_json({
      ...item,
      name_dst: write_item_name_text(item["name_dst"], next_name_dst),
    }).to_json();
  }

  /**
   * 校对写入只比较会被本服务修改的字段，避免无关字段触发空写
   */
  private are_items_equal(left: MutableJsonRecord, right: MutableJsonRecord): boolean {
    return (
      String(left["dst"] ?? "") === String(right["dst"] ?? "") &&
      are_item_name_fields_equal(left["name_dst"], right["name_dst"]) &&
      String(left["status"] ?? "") === String(right["status"] ?? "") &&
      Number(left["retry_count"] ?? 0) === Number(right["retry_count"] ?? 0)
    );
  }

  /**
   * 只从最终实际写入的 item 中收集变更 id，避免不存在的提交触发行级补读
   */
  private collect_item_ids(items: MutableJsonRecord[]): number[] {
    const item_ids: number[] = [];
    const seen_item_ids = new Set<number>();
    for (const item of items) {
      const item_id = this.parse_integer_like(item["id"]);
      if (item_id === null || item_id <= 0 || seen_item_ids.has(item_id)) {
        continue;
      }
      seen_item_ids.add(item_id);
      item_ids.push(item_id);
    }
    return item_ids;
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
   * 译文更新命令必须非空、ID 唯一且每项至少包含一个可写字段。
   */
  private normalize_item_updates(value: JsonValue | undefined): ProofreadingItemUpdate[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > MAX_PROOFREADING_ITEM_UPDATES
    ) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "invalid_proofreading_item_updates" },
      });
    }
    const updates: ProofreadingItemUpdate[] = [];
    const item_ids = new Set<number>();
    for (const raw_update of value) {
      if (!is_json_record(raw_update)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "invalid_proofreading_item_update" },
        });
      }
      const item_id = this.parse_integer_or_throw(raw_update["item_id"]);
      if (item_id <= 0 || item_ids.has(item_id)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "duplicate_or_invalid_item_id", item_id },
        });
      }
      const has_dst = Object.prototype.hasOwnProperty.call(raw_update, "dst");
      const has_name_dst = Object.prototype.hasOwnProperty.call(raw_update, "name_dst");
      if (!has_dst && !has_name_dst) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "empty_proofreading_item_update", item_id },
        });
      }
      if (
        (has_dst && typeof raw_update["dst"] !== "string") ||
        (has_name_dst && typeof raw_update["name_dst"] !== "string")
      ) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "invalid_proofreading_translation_field", item_id },
        });
      }
      item_ids.add(item_id);
      updates.push({
        item_id,
        ...(has_dst ? { dst: raw_update["dst"] as string } : {}),
        ...(has_name_dst ? { name_dst: raw_update["name_dst"] as string } : {}),
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
  ): Map<number, MutableJsonRecord> {
    const items_by_id = new Map<number, MutableJsonRecord>();
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
      items_by_id.set(item_id, { ...item, id: item_id });
    }
    return items_by_id;
  }

  /**
   * 读取校对字段 patch 所需的窄行事实，避免批量状态操作解析完整 item JSON。
   */
  private get_item_write_facts_by_ids(
    project_path: string,
    item_ids: number[],
  ): Map<number, MutableJsonRecord> {
    const items_by_id = new Map<number, MutableJsonRecord>();
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
   * 校对写入口只接受当前状态域，非法值按未处理状态兜底
   */
  private normalize_item_status(value: JsonValue | undefined): ItemStatus {
    return Item.normalize_status(value);
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

    throw new AppErrors.RequestValidationError({
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
      throw new AppErrors.RequestValidationError();
    }
    return parsed;
  }

  /**
   * item_id 只接受整数数字或整数字符串，拒绝布尔值和小数兼容
   */
  private parse_integer_like(value: JsonValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[+-]?\d+$/.test(trimmed)) {
        return Number.parseInt(trimmed, 10);
      }
    }
    return null;
  }
}
