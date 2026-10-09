import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { ProjectDataReader, create_empty_quality_rule_block } from "../project/project-data-reader";
import type { ProjectCommittedChange } from "../project/project-committed-change";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { type QualityRuleBlock } from "../../shared/quality/quality-rule-state";
import { create_empty_project_prompts, type ProjectPrompts } from "../../domain/prompt";
import { createProofreadingReader } from "../../shared/proofreading/proofreading-reader";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import { create_cache_change, type CacheChange } from "./cache-change";
import type { CacheFreshness, CacheReadPort, CacheSnapshot } from "./cache-types";
import { FileCache } from "./file-cache";
import { ItemCache } from "./item-cache";
import { ProofreadingCache } from "./proofreading-cache";
import { QualityRuleStatisticsCache } from "./quality-rule-statistics-cache";

/**
 * CacheManager 内部的小型数据块缓存；只隔离顶层对象，嵌套 JSON 按不可变值使用。
 */
class ProjectDataBlockCache<T extends object> {
  private block: T; // 当前完整块；替换与清理均由此缓存拥有。

  /** 恢复钩子由组合根提供，每次读取先确认热缓存可用。 */
  public constructor(
    private readonly before_read: () => void,
    private readonly create_empty: () => T,
  ) {
    this.block = create_empty();
  }

  /** 替换时隔离顶层引用，嵌套项目事实按不可变值共享。 */
  public replace(block: T): void {
    this.block = { ...block };
  }

  /** 工程卸载时释放该数据块。 */
  public clear(): void {
    this.block = this.create_empty();
  }

  /** 恢复完成后返回顶层副本，避免调用者修改缓存结构。 */
  public readBlock(): T {
    this.before_read();
    return { ...this.block };
  }
}

/**
 * CacheManager 是 loaded project 的 session 热读缓存组合根。
 */
export class CacheManager implements CacheReadPort {
  private readonly database: ProjectDatabase;
  private readonly data_reader: ProjectDataReader; // 数据库事实只经由 ProjectDataReader 读取。
  private readonly log_manager: Pick<LogManager, "warning" | "error"> | null; // 恢复失败只记录诊断。
  private project_path = ""; // 空字符串表示当前无 loaded project 缓存。
  private epoch = 0; // 每次完整热机递增，视图缓存用它隔离旧身份。
  private freshness: CacheFreshness = "empty"; // 读取前用 freshness 判断是否需要恢复。
  private section_revisions: ProjectDataSectionRevisions = {}; // 对外暴露的 section revision 快照。
  public readonly items = new ItemCache(() => this.recover_if_needed());
  public readonly files = new FileCache(() => this.recover_if_needed());
  public readonly quality = new ProjectDataBlockCache<QualityRuleBlock>(
    () => this.recover_if_needed(),
    create_empty_quality_rule_block,
  );
  public readonly prompts = new ProjectDataBlockCache<ProjectPrompts>(
    () => this.recover_if_needed(),
    create_empty_project_prompts,
  );

  public readonly proofreading: ProofreadingCache;
  public readonly qualityStatistics: QualityRuleStatisticsCache;

  /**
   * 构造所有子缓存，并把可恢复读取钩子下发给轻量 block 缓存。
   */
  public constructor(options: {
    database: ProjectDatabase;
    logManager: Pick<LogManager, "warning" | "error"> | null;
    appSettingService: AppSettingService;
    workerClient: ComputeWorkerClient;
  }) {
    this.database = options.database;
    this.data_reader = new ProjectDataReader(options.database);
    this.log_manager = options.logManager;
    this.proofreading = new ProofreadingCache({
      cache: this,
      appSettingService: options.appSettingService,
      workerClient: options.workerClient,
      reader: createProofreadingReader(),
      readPages: (projectPath) => this.data_reader.read_pdf_documents(projectPath),
    });
    this.qualityStatistics = new QualityRuleStatisticsCache({
      cache: this,
      workerClient: options.workerClient,
    });
  }

  /**
   * 为当前项目执行完整热机，后续 query 可走内存读取。
   */
  public async warmProject(project_path: string): Promise<void> {
    this.rebuild_full_project_cache(project_path);
    this.proofreading.clearProject();
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
    this.qualityStatistics.clear();
    this.proofreading.clearProject(project_path);
    this.section_revisions = {};
  }

  /**
   * 将提交结果应用到缓存，失败后进入下一次读取前恢复状态。
   */
  public async applyCommittedChange(committed: ProjectCommittedChange): Promise<void> {
    if (committed.projectPath !== this.project_path) return;
    const change = create_cache_change(committed);
    try {
      if (committed.itemRecords !== undefined)
        this.items.applyChange(change.items, committed.itemRecords);
      if (committed.fileRecords !== undefined) this.files.replace(committed.fileRecords);
      if (committed.quality !== undefined) this.quality.replace(committed.quality);
      if (committed.prompts !== undefined) this.prompts.replace(committed.prompts);
      // 基础事实与修订在任何异步视图同步之前一起切换。
      this.section_revisions = { ...committed.sectionRevisions };
      await this.apply_view_change(change, this.section_revisions);
    } catch (cause) {
      this.mark_recoverable_error(committed);
      throw cause;
    }
  }

  /** 同一条目修订下复用文件元数据，文件排序无需解析正文。 */
  public readFileMetadata(
    project: string,
    revision: number,
  ): ReturnType<ItemCache["readFileMetadata"]> | undefined {
    return project === this.project_path &&
      this.freshness === "fresh" &&
      (this.section_revisions.items ?? 0) === revision
      ? this.items.readFileMetadata()
      : undefined;
  }

  /** 缓存范围携带修订，事务只在相同版本下采用候选 ID。 */
  public readItemWriteScope(
    project_path: string,
    ids: readonly number[],
  ): { ids: number[]; revision: number } | null {
    this.recover_if_needed();
    if (project_path !== this.project_path || this.freshness !== "fresh") return null;
    return { ids: this.items.readWriteScope(ids), revision: this.section_revisions.items ?? 0 };
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
    this.database.with_project_scope(project_path, () => {
      const meta = this.data_reader.get_all_meta(project_path);
      const items_snapshot = this.data_reader.build_runtime_items_snapshot(project_path);
      const files_block = this.data_reader.build_files_record_block(
        project_path,
        items_snapshot.item_records,
      );
      const quality_block = this.data_reader.build_quality_block(project_path, meta);
      const prompts_block = this.data_reader.build_prompts_block(project_path, meta);
      const section_revisions = this.data_reader.build_section_revisions(meta);
      this.project_path = project_path;
      this.epoch += 1;
      this.items.replace(items_snapshot.item_records);
      this.files.replace(files_block);
      this.quality.replace(quality_block);
      this.prompts.replace(prompts_block);
      this.qualityStatistics.clear();
      this.section_revisions = section_revisions;
      this.freshness = "fresh";
    });
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
   * 标记可恢复错误并记录提交来源，由写入口统一报告提交后失败。
   */
  private mark_recoverable_error(event: ProjectCommittedChange): void {
    this.freshness = "recoverable_error";
    this.log_manager?.warning("CacheManager 缓存维护失败，后续读取将尝试恢复。", {
      source: "cache-manager",
      context: {
        sections: event.updatedSections,
        project_path: event.projectPath,
      },
    });
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
}
