import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { ProjectDataReader } from "../project/project-data";
import type { ProjectEvent, ProjectEventBus, ProjectEventType } from "../project/project-events";
import type { BackendWorkerClient } from "../worker/worker-client";
import { createProofreadingListReader } from "../../shared/proofreading/proofreading-list-reader";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import { AnalysisCache } from "./analysis/analysis-cache";
import { create_cache_change, type CacheChange } from "./cache-change";
import type { CacheFreshness, CacheReadPort, CacheSnapshot } from "./cache-types";
import { FileCache } from "./file/file-cache";
import { ItemCache } from "./item/item-cache";
import { PromptCache } from "./prompt/prompt-cache";
import { ProofreadingCache } from "./proofreading/proofreading-cache";
import { QualityCache } from "./quality/quality-cache";
import { QualityStatisticsCache } from "./quality/quality-statistics-cache";

// 这些项目事件会影响 session 热读缓存，其他事件由各领域服务自行处理。
const CACHE_EVENT_TYPES: ProjectEventType[] = [
  "project.opened_for_cache",
  "project.unloaded",
  "project.items.changed",
  "project.quality.changed",
  "project.prompts.changed",
  "project.settings.changed",
  "project.analysis.changed",
];

/**
 * CacheManager 是 loaded project 的 session 热读缓存组合根。
 */
export class CacheManager implements CacheReadPort {
  private readonly data_reader: ProjectDataReader; // 数据库事实只经由 ProjectDataReader 读取。
  private readonly log_manager: Pick<LogManager, "warning" | "error"> | null; // 恢复失败只记录诊断。
  private project_path = ""; // 空字符串表示当前无 loaded project 缓存。
  private epoch = 0; // 每次完整热机递增，视图缓存用它隔离旧身份。
  private freshness: CacheFreshness = "empty"; // 读取前用 freshness 判断是否需要恢复。
  private section_revisions: ProjectDataSectionRevisions = {}; // 对外暴露的 section revision 快照。
  private recoverable_error: unknown = null; // 保留最近一次可恢复错误，方便未来诊断扩展。
  public readonly items = new ItemCache(() => this.recover_if_needed());
  public readonly files = new FileCache(() => this.recover_if_needed());
  public readonly quality = new QualityCache(() => this.recover_if_needed());
  public readonly prompts = new PromptCache(() => this.recover_if_needed());
  public readonly analysis = new AnalysisCache(() => this.recover_if_needed());
  public readonly proofreading: ProofreadingCache;
  public readonly qualityStatistics: QualityStatisticsCache;

  /**
   * 构造所有子缓存，并把可恢复读取钩子下发给轻量 block 缓存。
   */
  public constructor(options: {
    database: ProjectDatabase;
    logManager: Pick<LogManager, "warning" | "error"> | null;
    appSettingService: AppSettingService;
    workerClient: BackendWorkerClient;
  }) {
    this.data_reader = new ProjectDataReader(options.database);
    this.log_manager = options.logManager;
    this.proofreading = new ProofreadingCache({
      cache: this,
      appSettingService: options.appSettingService,
      workerClient: options.workerClient,
      service: createProofreadingListReader(),
    });
    this.qualityStatistics = new QualityStatisticsCache({
      cache: this,
      workerClient: options.workerClient,
    });
  }

  /**
   * 订阅项目事件总线，缓存只消费会影响热读事实的事件。
   */
  public subscribe(project_event_bus: ProjectEventBus): void {
    for (const event_type of CACHE_EVENT_TYPES) {
      project_event_bus.subscribe(event_type, async (event) => {
        await this.handleProjectEvent(event);
      });
    }
  }

  /**
   * 为当前项目执行完整热机，后续 query 可走内存读取。
   */
  public async warmProject(project_path: string): Promise<void> {
    this.rebuild_full_project_cache(project_path);
  }

  /**
   * 清理当前项目缓存；传入其它项目路径时忽略迟到卸载事件。
   */
  public clearProject(project_path?: string): void {
    if (
      project_path !== undefined &&
      this.project_path !== "" &&
      this.project_path !== project_path
    ) {
      return;
    }
    this.project_path = "";
    this.epoch += 1;
    this.freshness = "empty";
    this.items.clear();
    this.files.clear();
    this.quality.clear();
    this.prompts.clear();
    this.analysis.clear();
    this.section_revisions = {};
    this.recoverable_error = null;
  }

  /**
   * 将项目事件转换成缓存更新，失败后进入下一次读取前恢复状态。
   */
  public async handleProjectEvent(event: ProjectEvent): Promise<void> {
    if (event.type === "project.opened_for_cache") {
      await this.warmProject(event.projectPath);
      await this.proofreading.clearProject();
      this.qualityStatistics.clear();
      return;
    }
    if (event.type === "project.unloaded") {
      this.clearProject(event.projectPath);
      await this.proofreading.clearProject(event.projectPath);
      this.qualityStatistics.clear();
      return;
    }
    if (event.projectPath !== this.project_path) {
      return;
    }
    try {
      await this.applyChange(create_cache_change(event));
    } catch (error) {
      this.mark_recoverable_error(error, event);
    }
  }

  /**
   * 应用内部缓存更新计划，基础缓存和视图缓存共享同一 revision 结果。
   */
  public async applyChange(change: CacheChange): Promise<void> {
    const next_section_revisions = this.merge_section_revisions(change.sectionRevisions);
    if (change.fullRebuild) {
      this.rebuild_full_project_cache(change.projectPath);
      await this.apply_view_change(change, this.section_revisions);
      return;
    }
    this.apply_base_change(change);
    await this.apply_view_change(change, next_section_revisions);
    this.section_revisions = next_section_revisions;
  }

  /**
   * 读取当前缓存掌握的 section revision。
   */
  public readSectionRevisions(): ProjectDataSectionRevisions {
    this.recover_if_needed();
    return { ...this.section_revisions };
  }

  /**
   * 返回项目身份、热机世代和 item 数量的轻量快照。
   */
  public snapshot(): CacheSnapshot {
    return {
      projectPath: this.project_path,
      epoch: this.epoch,
      freshness: this.freshness,
      sectionRevisions: { ...this.section_revisions },
      itemCount: this.items.size(),
    };
  }

  /**
   * 从数据库重建所有基础 block 缓存。
   */
  private rebuild_full_project_cache(project_path: string): void {
    const meta = this.data_reader.get_all_meta(project_path);
    const items_snapshot = this.data_reader.build_runtime_items_snapshot(project_path);
    const files_block = this.data_reader.build_files_record_block(project_path, items_snapshot);
    const quality_block = this.data_reader.build_quality_block(project_path, meta);
    const prompts_block = this.data_reader.build_prompts_block(project_path, meta);
    const analysis_block = this.data_reader.build_analysis_block(meta);
    const section_revisions = this.data_reader.build_section_revisions(meta);
    this.project_path = project_path;
    this.epoch += 1;
    this.items.replace(items_snapshot.item_records);
    this.files.replace(files_block);
    this.quality.replace(quality_block);
    this.prompts.replace(prompts_block);
    this.analysis.replace(analysis_block);
    this.section_revisions = section_revisions;
    this.freshness = "fresh";
    this.recoverable_error = null;
  }

  /**
   * 若上一轮维护失败，则在下一次读取前用数据库事实重建缓存。
   */
  private recover_if_needed(): void {
    if (this.freshness !== "recoverable_error") {
      return;
    }
    if (this.project_path === "") {
      return;
    }
    this.rebuild_full_project_cache(this.project_path);
  }

  /**
   * 标记可恢复错误并记录触发事件，避免事件处理链路抛出后中断总线。
   */
  private mark_recoverable_error(error: unknown, event: ProjectEvent): void {
    this.freshness = "recoverable_error";
    this.recoverable_error = error;
    this.log_manager?.warning("CacheManager 缓存维护失败，后续读取将尝试恢复。", {
      source: "cache-manager",
      context: {
        event_type: event.type,
        project_path: event.projectPath,
      },
    });
  }

  /**
   * 更新 item 和 meta block 这些基础缓存。
   */
  private apply_base_change(change: CacheChange): void {
    const meta_reader = this.create_meta_reader(change.projectPath);
    if (change.items.mode === "delta") {
      this.items.applyChange(change.items, this.read_item_delta_records(change));
    }
    if (change.quality.mode === "full") {
      this.quality.replace(this.data_reader.build_quality_block(change.projectPath, meta_reader()));
    }
    if (change.prompts.mode === "full") {
      this.prompts.replace(this.data_reader.build_prompts_block(change.projectPath, meta_reader()));
    }
    if (change.analysis.mode === "full") {
      this.analysis.replace(this.data_reader.build_analysis_block(meta_reader()));
    }
  }

  /**
   * 更新依赖基础缓存的视图缓存。
   */
  private async apply_view_change(
    change: CacheChange,
    next_section_revisions: ProjectDataSectionRevisions,
  ): Promise<void> {
    await this.proofreading.applyChange(change, next_section_revisions);
    this.qualityStatistics.applyChange(change);
  }

  /**
   * 读取 item 增量所需的完整行；字段 patch 已携带字段值时无需回库。
   */
  private read_item_delta_records(
    change: CacheChange,
  ): ReturnType<ProjectDataReader["build_item_records_by_ids"]> {
    if (change.items.mode !== "delta") {
      return [];
    }
    if (change.items.sourcePayloadMode === "field-patch") {
      return [];
    }
    const delete_ids = new Set(change.items.deleteIds);
    const changed_ids = change.items.changedIds.filter((item_id) => !delete_ids.has(item_id));
    return changed_ids.length === 0
      ? []
      : this.data_reader.build_item_records_by_ids(change.projectPath, changed_ids);
  }

  /**
   * 延迟读取 meta，多个 block 同时重建时只查一次数据库。
   */
  private create_meta_reader(
    project_path: string,
  ): () => ReturnType<ProjectDataReader["get_all_meta"]> {
    let meta: ReturnType<ProjectDataReader["get_all_meta"]> | null = null;
    return () => {
      if (meta === null) {
        meta = this.data_reader.get_all_meta(project_path);
      }
      return meta;
    };
  }

  /**
   * 将事件中的 section revision 合并到当前缓存快照。
   */
  private merge_section_revisions(
    section_revisions: ProjectDataSectionRevisions,
  ): ProjectDataSectionRevisions {
    return {
      ...this.section_revisions,
      ...section_revisions,
    };
  }
}
