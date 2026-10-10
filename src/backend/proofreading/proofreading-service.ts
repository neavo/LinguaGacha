import type { JsonRecord, JsonValue } from "../../domain/json";
import { ProjectWriteStore } from "../project/project-write-store";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import {
  require_project_expected_section_revisions,
  type ProjectExpectedSectionRevisions,
  type ProjectItemWriteChange,
} from "../project/project-write-request";
import { is_item_manual_status, type ItemManualStatus } from "../../domain/item";
import { is_json_record } from "../../domain/json";
import type { ProjectWriteResult } from "../../shared/project-event";
import { read_item_name_text } from "../../shared/item-name";
import {
  apply_project_item_manual_update,
  apply_project_item_field_patch,
  type ProjectItemManualUpdate,
  type ProjectItemFieldPatch,
} from "../../shared/project/project-item-update";
import { compile_text_pattern, replace_text_pattern } from "../../shared/text/text-pattern";
import * as AppErrors from "../../shared/error";

type ProofreadingItemUpdate = ProjectItemManualUpdate & {
  item_id: number;
};

const DEFAULT_PROOFREADING_UPDATE_SOURCE = "proofreading_apply_item_changes";

/**
 * 承载校对同步写入口，把客户端命令转换为后端项目事实。
 */
export class ProofreadingService {
  private readonly runtime_gate: RuntimeOperationGate; // 用户与 Agent 写入口共享串行门禁

  private readonly session_state: ProjectSessionState; // 校对同步写入口只以公开会话状态定位当前工程

  private readonly write_store: ProjectWriteStore; // 校对只提交业务补丁，事务和事件统一由 ProjectWriteStore 完成

  /**
   * 注入数据库与运行时桥，保证写库和读侧缓存同步都可被测试替换
   */
  public constructor(
    runtime_gate: RuntimeOperationGate,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
  ) {
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
    return await this.write_store.apply_project_item_changes({
      projectPath: project_path,
      expectedSectionRevisions: expected_section_revisions,
      source,
      itemIds: updates.map((update) => update.item_id),
      prepareChanges: (current_by_id) => {
        const changes: ProjectItemWriteChange[] = [];
        for (const update of updates) {
          const current = current_by_id.get(update.item_id);
          if (current === undefined) {
            throw new AppErrors.AppError("request.validation_failed", {
              diagnostic_context: { reason: "item_not_found", item_id: update.item_id },
            });
          }
          const next = apply_project_item_manual_update(current, update);
          if (next !== null) changes.push({ item_id: update.item_id, current, next });
        }
        return changes;
      },
    });
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
    return await this.write_store.apply_project_item_changes({
      projectPath: project_path,
      expectedSectionRevisions: expected_section_revisions,
      source: DEFAULT_PROOFREADING_UPDATE_SOURCE,
      itemIds: item_ids,
      prepareChanges: (current_by_id) => {
        const changes: ProjectItemWriteChange[] = [];
        for (const item_id of item_ids) {
          const item = current_by_id.get(item_id);
          if (item === undefined) {
            continue;
          }
          const dst_replace_result = replace_text_pattern({
            text: String(item["dst"] ?? ""),
            pattern,
            replacement_text: String(request["replace_text"] ?? ""),
            replacement_syntax: (request["is_regex"] ?? false) ? "javascript" : "literal",
          });
          const current_name_dst = read_item_name_text(item["name_dst"]);
          const name_replace_result = replace_text_pattern({
            text: current_name_dst,
            pattern,
            replacement_text: String(request["replace_text"] ?? ""),
            replacement_syntax: (request["is_regex"] ?? false) ? "javascript" : "literal",
          });
          const next_item = apply_project_item_manual_update(item, {
            dst: dst_replace_result.text,
            name_dst: name_replace_result.text,
          });
          if (next_item === null) continue;
          changes.push({ item_id, current: item, next: next_item });
        }
        return changes;
      },
    });
  }

  /** 批量清空正文与姓名译文，并按用户意图决定是否恢复未翻译状态。 */
  public async clear_translations(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(
      async () => await this.clear_translations_under_lease(request),
    );
  }

  /** 在项目写租约内按统一字段补丁筛出实际变化并原子提交。 */
  private async clear_translations_under_lease(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const expected_section_revisions = this.prepare_write_context(request);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const reset_status = request["reset_status"];
    if (typeof reset_status !== "boolean") {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "invalid_clear_translation_reset_status" },
      });
    }
    const field_patch: ProjectItemFieldPatch = reset_status
      ? { dst: "", name_dst: null, status: "NONE" }
      : { dst: "", name_dst: null };
    return await this.write_store.apply_project_item_changes({
      projectPath: project_path,
      expectedSectionRevisions: expected_section_revisions,
      source: DEFAULT_PROOFREADING_UPDATE_SOURCE,
      itemIds: item_ids,
      prepareChanges: (current_by_id) => {
        const changes: ProjectItemWriteChange[] = [];
        for (const item_id of item_ids) {
          const item = current_by_id.get(item_id);
          if (item === undefined) {
            continue;
          }
          const next_item = apply_project_item_field_patch(item, field_patch);
          if (next_item === null) continue;
          changes.push({ item_id, current: item, next: next_item });
        }
        return changes;
      },
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
    if (!Array.isArray(value) || value.length === 0) {
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
   * 人工状态菜单只暴露三种可写状态，其它计算状态不能从校对页直接写入
   */
  private parse_manual_status_or_throw(value: JsonValue | undefined): ItemManualStatus {
    if (is_item_manual_status(value)) return value;

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
