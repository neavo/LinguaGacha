import { AppError } from "../../shared/error";
import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import {
  ProjectDataReader,
  create_empty_quality_rule_block,
  type ProjectDataSnapshot,
} from "../project/project-data-reader";
import type { ProjectCommittedChange } from "../project/project-committed-change";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { type QualityRuleBlock } from "../../shared/quality/quality-rule-state";
import { create_empty_project_prompts, type ProjectPrompts } from "../../domain/prompt";
import {
  DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  type ProjectLanguageSettings,
} from "../../domain/project-settings";
import { createProofreadingReader } from "../../shared/proofreading/proofreading-reader";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type { CacheFreshness, CacheReadPort, CacheSnapshot } from "./cache-types";
import { FileCache } from "./file-cache";
import { ItemCache } from "./item-cache";
import { ProofreadingCache } from "./proofreading-cache";
import { QualityRuleStatisticsCache } from "./quality-rule-statistics-cache";

/**
 * 数据块缓存只隔离顶层对象，嵌套 JSON 按不可变值使用。
 */
class ProjectDataBlockCache<T extends object> {
  private block: T; // 当前块的替换与清理由本缓存拥有。

  /** 恢复钩子由组合根提供，每次读取先确认热缓存可用。 */
  public constructor(
    private readonly before_read: () => void,
    create_empty: () => T,
  ) {
    this.block = create_empty();
  }

  /** 替换时隔离顶层引用，嵌套项目事实按不可变值共享。 */
  public replace(block: T): void {
    this.block = { ...block };
  }

  /** 恢复完成后返回顶层副本，避免调用者修改缓存结构。 */
  public readBlock(): T {
    this.before_read();
    return { ...this.block };
  }
}

/**
 * ProjectCache 是 loaded project 的 session 热读缓存组合根。
 */
export class ProjectCache implements CacheReadPort {
  private readonly database: ProjectDatabase;
  private readonly log_manager: Pick<LogManager, "warning" | "error"> | null; // 恢复失败只记录诊断。
  private readonly project_path: string;
  private readonly project_id: string;
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
  public readonly languages = new ProjectDataBlockCache<ProjectLanguageSettings>(
    () => this.recover_if_needed(),
    () => DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  );

  public readonly proofreading: ProofreadingCache;
  public readonly qualityStatistics: QualityRuleStatisticsCache;

  /**
   * 构造所有子缓存，并把可恢复读取钩子下发给轻量 block 缓存。
   */
  public constructor(options: {
    projectPath: string;
    projectId: string;
    snapshot?: ProjectDataSnapshot;
    database: ProjectDatabase;
    logManager: Pick<LogManager, "warning" | "error"> | null;
    workerClient: ComputeWorkerClient;
  }) {
    this.project_path = options.projectPath;
    this.project_id = options.projectId;
    this.database = options.database;
    this.log_manager = options.logManager;
    this.proofreading = new ProofreadingCache({
      cache: this,
      workerClient: options.workerClient,
      reader: createProofreadingReader(),
    });
    this.qualityStatistics = new QualityRuleStatisticsCache({
      cache: this,
      workerClient: options.workerClient,
    });
    if (options.snapshot) this.install_snapshot(options.snapshot);
  }

  /** 安装本工程的已提交事实，失败后读取仍须先重建。 */
  private install_snapshot(snapshot: ProjectDataSnapshot): void {
    this.freshness = "recoverable_error"; // 安装中断后，下次读取必须重建全部基础事实。
    this.items.replace(snapshot.items);
    this.files.replace(snapshot.files);
    this.quality.replace(snapshot.quality);
    this.prompts.replace(snapshot.prompts);
    this.languages.replace(snapshot.languages);
    this.qualityStatistics.clear();
    this.proofreading.clearProject();
    this.section_revisions = { ...snapshot.section_revisions };
    this.freshness = "fresh";
  }

  /**
   * 将提交结果应用到缓存，失败时等待数据库重建后报告原始错误。
   */
  public async applyCommittedChange(committed: ProjectCommittedChange): Promise<void> {
    if (committed.projectPath !== this.project_path) return;
    try {
      if (committed.items !== undefined) this.items.applyChange(committed.items);
      if (committed.files !== undefined) this.files.replace(committed.files);
      if (committed.quality !== undefined) this.quality.replace(committed.quality);
      if (committed.prompts !== undefined) this.prompts.replace(committed.prompts);
      if (committed.languages !== undefined) this.languages.replace(committed.languages);
      // 基础事实、修订与视图失效同步切换，读取不会跨越两次提交。
      this.section_revisions = { ...committed.sectionRevisions };
      this.proofreading.applyChange(committed);
      this.qualityStatistics.applyChange(committed);
    } catch (cause) {
      this.mark_recoverable_error(committed);
      try {
        await this.refresh();
      } catch (recovery) {
        throw new AggregateError([cause, recovery], "Cache recovery failed.");
      }
      throw cause;
    }
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
      projectId: this.project_id,
      freshness: this.freshness,
      sectionRevisions: { ...this.section_revisions },
      itemCount: this.items.size(),
    };
  }

  /**
   * 从数据库重建所有基础缓存，读取完成后一次安装。
   */
  public async refresh(): Promise<void> {
    const project_path = this.project_path;
    const snapshot = await this.database.read(project_path, (reader) =>
      new ProjectDataReader(reader).read_snapshot(project_path),
    );
    this.install_snapshot(snapshot);
  }

  /**
   * 重建失败时阻止同步读取旧事实，调用方按已提交语义重载。
   */
  private recover_if_needed(): void {
    if (this.freshness !== "recoverable_error") {
      return;
    }
    throw new AppError("data.committed_sync_failed", {
      public_details: { committed: true, action: "reload_project" },
    });
  }

  /**
   * 标记可恢复错误并记录提交来源，由写入口统一报告提交后失败。
   */
  private mark_recoverable_error(event: ProjectCommittedChange): void {
    this.freshness = "recoverable_error";
    this.log_manager?.warning("ProjectCache 缓存维护失败，正在从数据库重建。", {
      source: "project-cache",
      context: {
        sections: event.updatedSections,
        change_source: event.source,
        project_path: event.projectPath,
      },
    });
  }
}
