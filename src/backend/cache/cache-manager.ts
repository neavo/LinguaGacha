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

const CACHE_EVENT_TYPES: ProjectEventType[] = [
  "project.opened_for_cache",
  "project.unloaded",
  "project.items.changed",
  "project.quality.changed",
  "project.prompts.changed",
  "project.settings.changed",
  "project.analysis.changed",
];

export class CacheManager implements CacheReadPort {
  private readonly data_reader: ProjectDataReader;
  private readonly log_manager: Pick<LogManager, "warning" | "error"> | null;
  private project_path = "";
  private epoch = 0;
  private freshness: CacheFreshness = "empty";
  private section_revisions: ProjectDataSectionRevisions = {};
  private recoverable_error: unknown = null;
  public readonly items = new ItemCache(() => this.recover_if_needed());
  public readonly files = new FileCache(() => this.recover_if_needed());
  public readonly quality = new QualityCache(() => this.recover_if_needed());
  public readonly prompts = new PromptCache(() => this.recover_if_needed());
  public readonly analysis = new AnalysisCache(() => this.recover_if_needed());
  public readonly proofreading: ProofreadingCache;
  public readonly qualityStatistics: QualityStatisticsCache;

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

  public subscribe(project_event_bus: ProjectEventBus): void {
    for (const event_type of CACHE_EVENT_TYPES) {
      project_event_bus.subscribe(event_type, async (event) => {
        await this.handleProjectEvent(event);
      });
    }
  }

  public async warmProject(project_path: string): Promise<void> {
    this.rebuild_full_project_cache(project_path);
  }

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

  public readSectionRevisions(): ProjectDataSectionRevisions {
    this.recover_if_needed();
    return { ...this.section_revisions };
  }

  public snapshot(): CacheSnapshot {
    return {
      projectPath: this.project_path,
      epoch: this.epoch,
      freshness: this.freshness,
      sectionRevisions: { ...this.section_revisions },
      itemCount: this.items.size(),
    };
  }

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

  private recover_if_needed(): void {
    if (this.freshness !== "recoverable_error") {
      return;
    }
    if (this.project_path === "") {
      return;
    }
    this.rebuild_full_project_cache(this.project_path);
  }

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

  private async apply_view_change(
    change: CacheChange,
    next_section_revisions: ProjectDataSectionRevisions,
  ): Promise<void> {
    await this.proofreading.applyChange(change, next_section_revisions);
    this.qualityStatistics.applyChange(change);
  }

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

  private merge_section_revisions(
    section_revisions: ProjectDataSectionRevisions,
  ): ProjectDataSectionRevisions {
    return {
      ...this.section_revisions,
      ...section_revisions,
    };
  }
}
