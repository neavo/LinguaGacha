import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  ProjectMutationCoordinator,
  type ProjectMutationRevisionContext,
} from "../project/project-mutation-coordinator";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectSessionState } from "../project/project-session-state";
import { Item } from "../../base/item";
import type { ProjectMutationResult } from "../../shared/project/event";
import {
  build_item_view_map,
  build_public_item_map,
  build_translation_extras_from_items,
  create_empty_translation_task_snapshot,
} from "../project/project-mutation-state";
import { compile_text_pattern, replace_text_pattern } from "../../shared/text/text-pattern";
import * as AppErrors from "../../shared/error";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

type ProofreadingMutationContext = {
  revision_context: ProjectMutationRevisionContext; // revision guard 快照是本次事务 bump 的唯一基线
  current_by_id: Map<number, MutableJsonRecord>; // 当前数据库事实索引，后端 mutation 只在它上面派生最终写入
};

/**
 * 承载校对同步写入口，把 renderer 命令转换为 Electron main 数据库事实
 */
export class ProofreadingService {
  private readonly database: ProjectDatabase; // 校对同步保存直接写 .lg，但仍只能通过 ProjectDatabase workflow 触达数据库

  private readonly session_state: ProjectSessionState; // 校对同步写入口只以 公开会话状态定位当前工程

  private readonly mutation_coordinator: ProjectMutationCoordinator; // 校对 mutation 的 revision guard、bump 和 canonical 事件统一经由协调器

  /**
   * 注入数据库与运行时桥，保证写库和读侧缓存同步都可被测试替换
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    project_change_publisher: ProjectChangePublisher | null = null,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.mutation_coordinator = new ProjectMutationCoordinator(database, project_change_publisher);
  }

  /**
   * 保存单条校对结果，renderer 只提交 item_id 与目标译文
   */
  public async save_item(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_save_item(request);
  }

  /**
   * 保存批量重置结果，renderer 只提交目标 item_ids
   */
  public async save_all(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_reset_items(request);
  }

  /**
   * 保存批量替换结果，替换语义在后端基于当前数据库事实执行
   */
  public async replace_all(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_replace_all(request);
  }

  /**
   * 单条保存只更新译文、状态和翻译进度 meta
   */
  private async persist_save_item(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
    const item_id = this.parse_integer_or_throw(request["item_id"]);
    const item = context.current_by_id.get(item_id);
    if (item === undefined) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "item_not_found", item_id },
      });
    }
    const next_item = this.apply_manual_dst(item, String(request["dst"] ?? ""));
    if (this.are_items_equal(item, next_item)) {
      return { accepted: true, changes: [] };
    }
    context.current_by_id.set(item_id, next_item);
    return this.persist_changed_items(project_path, context, [next_item]);
  }

  /**
   * 批量替换在后端编译文本模式，避免 renderer 提交替换后的最终事实
   */
  private async persist_replace_all(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
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
    const changed_items: MutableJsonRecord[] = [];
    for (const item_id of this.normalize_item_ids(request["item_ids"])) {
      const item = context.current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      const replace_result = replace_text_pattern({
        text: String(item["dst"] ?? ""),
        pattern,
        replacement_text: String(request["replace_text"] ?? ""),
        replacement_syntax: (request["is_regex"] ?? false) ? "javascript" : "literal",
      });
      if (replace_result.count <= 0 || replace_result.text === item["dst"]) {
        continue;
      }
      const next_item = this.apply_manual_dst(item, replace_result.text);
      context.current_by_id.set(item_id, next_item);
      changed_items.push(next_item);
    }
    return this.persist_changed_items(project_path, context, changed_items);
  }

  /**
   * 批量重置只清空目标 item 的译文、状态和重试计数
   */
  private async persist_reset_items(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
    const changed_items: MutableJsonRecord[] = [];
    for (const item_id of this.normalize_item_ids(request["item_ids"])) {
      const item = context.current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      const next_item = {
        ...item,
        dst: "",
        status: "NONE",
        retry_count: 0,
      };
      if (this.are_items_equal(item, next_item)) {
        continue;
      }
      context.current_by_id.set(item_id, next_item);
      changed_items.push(next_item);
    }
    return this.persist_changed_items(project_path, context, changed_items);
  }

  /**
   * 校对保存同时影响 item 行和 proofreading revision；item 为空时仍发布 section 变更供读侧对齐
   */
  private publish_project_data_change(
    project_path: string,
    changed_item_ids: number[],
  ): ProjectMutationResult {
    return this.mutation_coordinator.publish_project_data_change({
      projectPath: project_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: changed_item_ids,
      },
    });
  }

  /**
   * 校对 mutation 起手必须先校验 revision，再读取当前数据库事实
   */
  private prepare_mutation_context(
    project_path: string,
    request: JsonRecord,
  ): ProofreadingMutationContext {
    this.assert_no_legacy_fields(request, ["items", "translation_extras"]);
    const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
      project_path,
      request["expected_section_revisions"],
      ["items", "proofreading"],
    );

    const current_by_id = new Map<number, MutableJsonRecord>();
    for (const item of this.get_all_items(project_path)) {
      const item_id = this.parse_integer_like(item["id"]);
      if (item_id !== null && item_id > 0) {
        current_by_id.set(item_id, { ...item, id: item_id });
      }
    }
    return {
      revision_context,
      current_by_id,
    };
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
   * 写入变更 item，并由后端根据完整当前事实重建 translation_extras
   */
  private persist_changed_items(
    project_path: string,
    context: ProofreadingMutationContext,
    changed_items: MutableJsonRecord[],
  ): ProjectMutationResult {
    if (changed_items.length === 0) {
      return { accepted: true, changes: [] };
    }
    const translation_extras = this.build_translation_extras(project_path, context.current_by_id);
    this.database.execute_transaction([
      this.op("updateBatch", {
        projectPath: project_path,
        items: changed_items,
        meta: {
          translation_extras: translation_extras as unknown as DatabaseJsonValue,
        },
      }),
      ...this.mutation_coordinator.build_section_revision_operations(context.revision_context),
    ]);
    return this.publish_project_data_change(project_path, this.collect_item_ids(changed_items));
  }

  /**
   * 手动写入译文后由后端统一决定 status，不接受 renderer 提交 status 事实
   */
  private apply_manual_dst(item: MutableJsonRecord, next_dst: string): MutableJsonRecord {
    return {
      ...item,
      dst: next_dst,
      status: next_dst === "" ? this.normalize_item_status(item["status"]) : "PROCESSED",
    };
  }

  /**
   * 重建翻译进度时只消费当前 item 事实，并保留数据库现有 token/time 等进度基底
   */
  private build_translation_extras(
    project_path: string,
    current_by_id: Map<number, MutableJsonRecord>,
  ): Record<string, unknown> {
    const item_record: Record<string, MutableJsonRecord> = {};
    for (const [item_id, item] of current_by_id.entries()) {
      item_record[String(item_id)] = item;
    }
    const public_item_map = build_public_item_map(item_record);
    return build_translation_extras_from_items({
      task_snapshot: this.build_translation_task_snapshot_from_meta(project_path),
      items: build_item_view_map(public_item_map),
    });
  }

  /**
   * translation_extras 是数据库侧进度事实，重建统计时把它挂回 task_snapshot.progress
   */
  private build_translation_task_snapshot_from_meta(project_path: string): Record<string, unknown> {
    return {
      ...create_empty_translation_task_snapshot(),
      progress: this.normalize_object(this.get_all_meta(project_path)["translation_extras"]),
    };
  }

  /**
   * 校对写入只比较会被本服务修改的字段，避免无关字段触发空写
   */
  private are_items_equal(left: MutableJsonRecord, right: MutableJsonRecord): boolean {
    return (
      String(left["dst"] ?? "") === String(right["dst"] ?? "") &&
      String(left["status"] ?? "") === String(right["status"] ?? "") &&
      Number(left["retry_count"] ?? 0) === Number(right["retry_count"] ?? 0)
    );
  }

  /**
   * 当前 loaded 工程是校对保存的唯一目标
   */
  private async require_loaded_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
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
  private normalize_item_ids(value: ApiJsonValue | undefined): number[] {
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
   * 读取全部 item dict，供局部 merge 使用
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * 读取完整 meta，用于 revision 判断
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * 校对写入口只接受当前状态域，非法值按未处理状态兜底
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    return Item.normalize_status(value);
  }

  /**
   * item_id 命令字段使用严格转换，转换失败时保持请求失败语义
   */
  private parse_integer_or_throw(value: ApiJsonValue | undefined): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null) {
      throw new AppErrors.RequestValidationError();
    }
    return parsed;
  }

  /**
   * item_id 只接受整数数字或整数字符串，拒绝布尔值和小数兼容
   */
  private parse_integer_like(value: ApiJsonValue | undefined): number | null {
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

  /**
   * 把未知 JSON 收窄为对象，避免深层读取扩散类型断言
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 收窄 JSON 对象，保护数组和 null 不被当作 record
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 创建 database workflow 操作，避免业务方法重复拼协议壳
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
