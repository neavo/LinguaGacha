import type { ApiJsonValue } from "../api/api-types";
import type { ProjectEventBus } from "../project/project-events";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  ProjectChangeCoordinator,
  type ProjectMutationRevisionContext,
} from "../project/project-changes";
import { ProjectChangePublisher } from "../project/project-changes";
import { ProjectSessionState } from "../project/project-session";
import { Item, type ItemStatus } from "../../domain/item";
import type {
  ProjectChangeItemFieldPatch,
  ProjectChangeItemsPayload,
  ProjectMutationResult,
} from "../../shared/project-event";
import { create_empty_translation_task_snapshot } from "../project/project-changes";
import { compile_text_pattern, replace_text_pattern } from "../../shared/text/text-pattern";
import * as AppErrors from "../../shared/error";
import { is_task_progress_status } from "../../domain/task";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

// PROOFREADING MANUAL STATUS CODES 是领域白名单或配置表，集中维护避免分支散落。
const PROOFREADING_MANUAL_STATUS_CODES = [
  "NONE",
  "PROCESSED",
  "EXCLUDED",
] as const satisfies readonly ItemStatus[]; // 后端只接受菜单显式暴露的人工可写状态

type ProofreadingManualStatus = (typeof PROOFREADING_MANUAL_STATUS_CODES)[number];

type ProofreadingMutationContext = {
  revision_context: ProjectMutationRevisionContext; // revision guard 快照是本次事务 bump 的唯一基线
};

type ProofreadingItemChange = {
  current: MutableJsonRecord; // 数据库提交前的行事实，用于派生统计 delta
  next: MutableJsonRecord; // 数据库将要写入的最终行事实
};

type TranslationProgressCounters = {
  total_line: number;
  processed_line: number;
  error_line: number;
  line: number;
};

/**
 * 承载校对同步写入口，把 renderer 命令转换为 Electron main 数据库事实
 */
export class ProofreadingService {
  private readonly database: ProjectDatabase; // 校对同步保存直接写 .lg，但仍只能通过 ProjectDatabase workflow 触达数据库

  private readonly session_state: ProjectSessionState; // 校对同步写入口只以 公开会话状态定位当前工程

  private readonly mutation_coordinator: ProjectChangeCoordinator; // 校对 mutation 的 revision guard、bump 和 canonical 事件统一经由协调器

  /**
   * 注入数据库与运行时桥，保证写库和读侧缓存同步都可被测试替换
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    project_event_bus: ProjectEventBus,
    project_change_publisher: ProjectChangePublisher | null = null,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.mutation_coordinator = new ProjectChangeCoordinator(
      database,
      project_change_publisher,
      project_event_bus,
    );
  }

  /**
   * 保存单条校对结果，renderer 只提交 item_id 与目标译文
   */
  public async save_item(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_save_item(request);
  }

  /**
   * 保存批量替换结果，替换语义在后端基于当前数据库事实执行
   */
  public async replace_all(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_replace_all(request);
  }

  /**
   * 清空目标译文；状态和重试计数属于独立用户意图，不能在这里被隐式修改
   */
  public async clear_translations(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_clear_translations(request);
  }

  /**
   * 设置人工翻译状态；状态变更会清除重试计数，但不触碰译文内容
   */
  public async set_translation_status(request: JsonRecord): Promise<ProjectMutationResult> {
    return this.persist_set_translation_status(request);
  }

  /**
   * 单条保存只更新译文、状态和翻译进度 meta
   */
  private async persist_save_item(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
    const item_id = this.parse_integer_or_throw(request["item_id"]);
    const item = this.get_item_mutation_facts_by_ids(project_path, [item_id]).get(item_id);
    if (item === undefined) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "item_not_found", item_id },
      });
    }
    const next_item = this.apply_manual_dst(item, String(request["dst"] ?? ""));
    if (this.are_items_equal(item, next_item)) {
      return { accepted: true, changes: [] };
    }
    const field_patch = this.build_item_field_patch(item, next_item, ["dst", "status"]);
    return await this.persist_field_patch_items(project_path, context, {
      changes: [{ current: item, next: next_item }],
      field_patch,
      update_translation_extras: true,
    });
  }

  /**
   * 批量替换在后端编译文本模式，避免 renderer 提交替换后的最终事实
   */
  private async persist_replace_all(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
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
      changes.push({ current: item, next: next_item });
    }
    return await this.persist_changed_items(project_path, context, {
      changes,
      items_payload: {
        payloadMode: "canonical-delta",
        changedIds: this.collect_item_ids(changes.map((change) => change.next)),
      },
      update_translation_extras: true,
    });
  }

  /**
   * 批量清空译文只改 dst，保留 status 和 retry_count 供用户手动判定
   */
  private async persist_clear_translations(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const current_by_id = this.get_item_mutation_facts_by_ids(project_path, item_ids);
    const changes: ProofreadingItemChange[] = [];
    for (const item_id of item_ids) {
      const item = current_by_id.get(item_id);
      if (item === undefined) {
        continue;
      }
      const next_item = {
        ...item,
        dst: "",
      };
      if (this.are_items_equal(item, next_item)) {
        continue;
      }
      changes.push({ current: item, next: next_item });
    }
    return await this.persist_field_patch_items(project_path, context, {
      changes,
      field_patch: { dst: "" },
      update_translation_extras: false,
    });
  }

  /**
   * 批量设置状态只接受人工可写状态集合，并把旧重试计数从新状态事实中清掉
   */
  private async persist_set_translation_status(
    request: JsonRecord,
  ): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const context = this.prepare_mutation_context(project_path, request);
    const next_status = this.parse_manual_status_or_throw(request["status"]);
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const current_by_id = this.get_item_mutation_facts_by_ids(project_path, item_ids);
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
    return await this.persist_field_patch_items(project_path, context, {
      changes,
      field_patch: {
        status: next_status,
        retry_count: 0,
      },
      update_translation_extras: true,
    });
  }

  /**
   * 校对保存同时影响 item 行和 proofreading revision；item 为空时仍发布 section 变更供读侧对齐
   */
  private async publish_project_data_change(
    project_path: string,
    items_payload: Pick<
      ProjectChangeItemsPayload,
      "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
    >,
  ): Promise<ProjectMutationResult> {
    await this.mutation_coordinator.publish_app_events_for_committed_change({
      projectPath: project_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: items_payload,
    });
    return this.mutation_coordinator.publish_project_data_change({
      projectPath: project_path,
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: items_payload,
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

    return {
      revision_context,
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
   * 写入变更 item，并按状态 delta 更新翻译统计，避免校对热路径扫描全量条目。
   */
  private async persist_changed_items(
    project_path: string,
    context: ProofreadingMutationContext,
    args: {
      changes: ProofreadingItemChange[];
      items_payload: Pick<
        ProjectChangeItemsPayload,
        "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
      >;
      update_translation_extras: boolean;
    },
  ): Promise<ProjectMutationResult> {
    if (args.changes.length === 0) {
      return { accepted: true, changes: [] };
    }
    const update_args: Record<string, DatabaseJsonValue> = {
      projectPath: project_path,
      items: args.changes.map((change) => change.next) as unknown as DatabaseJsonValue,
    };
    if (args.update_translation_extras) {
      update_args.meta = {
        translation_extras: this.build_translation_extras_after_status_changes(
          project_path,
          context.revision_context,
          args.changes,
        ) as unknown as DatabaseJsonValue,
      };
    }
    this.database.execute_transaction([
      this.op("updateBatch", update_args),
      ...this.mutation_coordinator.build_section_revision_operations(context.revision_context),
    ]);
    return await this.publish_project_data_change(project_path, args.items_payload);
  }

  /**
   * 统一字段 patch 走数据库 JSON 局部写入，避免为校对批量操作构造完整 item DTO。
   */
  private async persist_field_patch_items(
    project_path: string,
    context: ProofreadingMutationContext,
    args: {
      changes: ProofreadingItemChange[];
      field_patch: ProjectChangeItemFieldPatch;
      update_translation_extras: boolean;
    },
  ): Promise<ProjectMutationResult> {
    if (args.changes.length === 0) {
      return { accepted: true, changes: [] };
    }
    const changed_item_ids = this.collect_item_ids(args.changes.map((change) => change.next));
    const patch_args: Record<string, DatabaseJsonValue> = {
      projectPath: project_path,
      itemIds: changed_item_ids,
      patch: args.field_patch as unknown as DatabaseJsonValue,
    };
    const operations: DatabaseOperation[] = [this.op("patchItemFieldsByIds", patch_args)];
    if (args.update_translation_extras) {
      const meta = {
        translation_extras: this.build_translation_extras_after_status_changes(
          project_path,
          context.revision_context,
          args.changes,
        ) as unknown as DatabaseJsonValue,
      };
      operations.push(
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta,
        }),
      );
    }
    this.database.execute_transaction([
      ...operations,
      ...this.mutation_coordinator.build_section_revision_operations(context.revision_context),
    ]);
    return await this.publish_project_data_change(project_path, {
      payloadMode: "field-patch",
      changedIds: changed_item_ids,
      fieldPatch: args.field_patch,
    });
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
   * translation_extras 只按本次旧状态到新状态的差量修正，token/time 等非状态字段原样保留。
   */
  private build_translation_extras_after_status_changes(
    project_path: string,
    revision_context: ProjectMutationRevisionContext,
    changes: ProofreadingItemChange[],
  ): Record<string, unknown> {
    const stored_progress = this.normalize_object(revision_context.meta["translation_extras"]);
    const progress = this.read_translation_progress(revision_context.meta);
    const counters = this.has_translation_progress_counters(stored_progress)
      ? this.read_translation_progress_counters(progress)
      : this.get_translation_status_summary(project_path);
    const next_counters = this.apply_translation_status_deltas(counters, changes);
    return {
      ...progress,
      ...next_counters,
    };
  }

  /**
   * 进度 meta 缺省时从空翻译任务进度起步，保证字段集合对任务面板稳定。
   */
  private read_translation_progress(meta: JsonRecord): Record<string, unknown> {
    const empty_snapshot = create_empty_translation_task_snapshot();
    return {
      ...this.normalize_object(empty_snapshot["progress"] as ApiJsonValue),
      ...this.normalize_object(meta["translation_extras"]),
    };
  }

  /**
   * 统计字段齐全时才允许差量更新复用 meta，否则用数据库聚合重新建立状态基线。
   */
  private has_translation_progress_counters(progress: Record<string, unknown>): boolean {
    return (
      this.is_finite_number(progress["total_line"]) &&
      this.is_finite_number(progress["processed_line"]) &&
      this.is_finite_number(progress["error_line"])
    );
  }

  /**
   * 从 progress 中读取非负整数统计，坏值在差量计算边界归零。
   */
  private read_translation_progress_counters(
    progress: Record<string, unknown>,
  ): TranslationProgressCounters {
    const processed_line = this.read_non_negative_integer(progress["processed_line"]);
    const error_line = this.read_non_negative_integer(progress["error_line"]);
    return {
      total_line: this.read_non_negative_integer(progress["total_line"]),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 通过 SQLite 聚合状态基线，避免 meta 缺失时退回 JS 全量解析。
   */
  private get_translation_status_summary(project_path: string): TranslationProgressCounters {
    const summary = this.normalize_object(
      this.database.execute(this.op("getItemStatusSummary", { projectPath: project_path })),
    );
    const processed_line = this.read_non_negative_integer(summary["processed_line"]);
    const error_line = this.read_non_negative_integer(summary["error_line"]);
    return {
      total_line: this.read_non_negative_integer(summary["total_line"]),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 每条变更只贡献旧状态和新状态的统计差，译文本身不参与工作台统计。
   */
  private apply_translation_status_deltas(
    counters: TranslationProgressCounters,
    changes: ProofreadingItemChange[],
  ): TranslationProgressCounters {
    let total_line = counters.total_line;
    let processed_line = counters.processed_line;
    let error_line = counters.error_line;
    for (const change of changes) {
      const before = this.count_translation_status(change.current["status"]);
      const after = this.count_translation_status(change.next["status"]);
      total_line += after.total_line - before.total_line;
      processed_line += after.processed_line - before.processed_line;
      error_line += after.error_line - before.error_line;
    }
    processed_line = Math.max(0, Math.trunc(processed_line));
    error_line = Math.max(0, Math.trunc(error_line));
    return {
      total_line: Math.max(0, Math.trunc(total_line)),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 翻译统计只认任务进度三态，跳过、排除和未知状态不进入分母。
   */
  private count_translation_status(value: ApiJsonValue | undefined): TranslationProgressCounters {
    const status = String(value ?? "");
    const is_progress_status = is_task_progress_status(status);
    const processed_line = status === "PROCESSED" ? 1 : 0;
    const error_line = status === "ERROR" ? 1 : 0;
    return {
      total_line: is_progress_status ? 1 : 0,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * field-patch 只发布本次统一改变的字段；值从后端最终 item 事实提取。
   */
  private build_item_field_patch(
    current_item: MutableJsonRecord,
    next_item: MutableJsonRecord,
    fields: Array<keyof ProjectChangeItemFieldPatch>,
  ): ProjectChangeItemFieldPatch {
    const patch: ProjectChangeItemFieldPatch = {};
    for (const field of fields) {
      if (field === "retry_count") {
        const retry_count = Number(next_item["retry_count"]);
        if (Number.isFinite(retry_count) && retry_count !== Number(current_item["retry_count"])) {
          patch.retry_count = Math.trunc(retry_count);
        }
        continue;
      }
      if (field === "status") {
        const status = Item.normalize_status(next_item["status"]);
        if (status !== current_item["status"]) {
          patch.status = status;
        }
        continue;
      }
      const dst = next_item["dst"];
      if (field === "dst" && typeof dst === "string" && dst !== current_item["dst"]) {
        patch.dst = dst;
      }
    }
    return patch;
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
   * 按目标 id 读取当前 item 事实，校对批量操作不再预热全量 items。
   */
  private get_items_by_ids(
    project_path: string,
    item_ids: number[],
  ): Map<number, MutableJsonRecord> {
    const items_by_id = new Map<number, MutableJsonRecord>();
    const value = this.database.execute(
      this.op("getItemsByIds", {
        projectPath: project_path,
        itemIds: item_ids,
      }),
    );
    if (!Array.isArray(value)) {
      return items_by_id;
    }
    for (const item of value) {
      if (!this.is_record(item)) {
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
  private get_item_mutation_facts_by_ids(
    project_path: string,
    item_ids: number[],
  ): Map<number, MutableJsonRecord> {
    const items_by_id = new Map<number, MutableJsonRecord>();
    const value = this.database.execute(
      this.op("getItemMutationFactsByIds", {
        projectPath: project_path,
        itemIds: item_ids,
      }),
    );
    if (!Array.isArray(value)) {
      return items_by_id;
    }
    for (const item of value) {
      if (!this.is_record(item)) {
        continue;
      }
      const item_id = this.parse_integer_like(item["id"]);
      if (item_id === null || item_id <= 0) {
        continue;
      }
      items_by_id.set(item_id, {
        id: item_id,
        dst: String(item["dst"] ?? ""),
        status: String(item["status"] ?? ""),
        retry_count: Number(item["retry_count"] ?? 0),
      });
    }
    return items_by_id;
  }

  /**
   * 校对写入口只接受当前状态域，非法值按未处理状态兜底
   */
  private normalize_item_status(value: ApiJsonValue | undefined): ItemStatus {
    return Item.normalize_status(value);
  }

  /**
   * 人工状态菜单只暴露三种可写状态，其它派生状态不能从校对页直接写入
   */
  private parse_manual_status_or_throw(value: ApiJsonValue | undefined): ProofreadingManualStatus {
    if (
      typeof value === "string" &&
      (PROOFREADING_MANUAL_STATUS_CODES as readonly string[]).includes(value)
    ) {
      return value as ProofreadingManualStatus;
    }

    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_proofreading_manual_status", status: value },
    });
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
   * 统计字段只接受有限数值，避免 NaN 进入持久化 meta。
   */
  private is_finite_number(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value);
  }

  /**
   * 持久化统计统一使用非负整数，消除小数和坏值对进度条的污染。
   */
  private read_non_negative_integer(value: unknown): number {
    const number_value = typeof value === "number" ? value : Number(value ?? 0);
    if (!Number.isFinite(number_value)) {
      return 0;
    }
    return Math.max(0, Math.trunc(number_value));
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
