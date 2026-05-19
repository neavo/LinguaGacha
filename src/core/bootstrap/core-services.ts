import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import { TaskEngine } from "../engine/core/engine";
import { create_o200k_base_token_counter } from "../engine/core/token-counter";
import { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { ProjectTaskStore } from "../engine/store/project-task-store";
import { WorkerPool } from "../engine/worker/worker-pool";
import type { WorkerPoolExecution } from "../engine/worker/worker-execution";
import { CoreEventHub } from "../events/core-event-hub";
import { FileExportService, type OutputFolderOpener } from "../file/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import { ModelService } from "../model/model-service";
import { ProjectChangeEventAdapter } from "../project/project-change-event-adapter";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { ProjectOperationGate } from "../project/project-operation-gate";
import { ProjectResetPreviewService } from "../project/project-reset-preview-service";
import { ProjectRuntimeProjectionService } from "../project/project-runtime-projection-service";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectSyncMutationService } from "../project/project-sync-mutation-service";
import { ProofreadingService } from "../service/proofreading-service";
import { QualityService } from "../service/quality-service";
import { TaskService } from "../service/task-service";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";

export interface CoreServicesOptions {
  paths: AppPathService; // paths 是启动阶段解析出的应用根与数据根权威
  metadata: AppMetadataService; // metadata 只读应用版本和 User-Agent，不参与运行态写入
  appSettingService: AppSettingService; // appSettingService 是配置文件唯一读写入口
  database: ProjectDatabase; // database 由 Bootstrap 持有并负责关闭，服务层只组合业务能力
  logManager: LogManager; // logManager 是 Core 内部日志和任务日志的唯一汇聚点
  openOutputFolder: OutputFolderOpener; // openOutputFolder 是 GUI 专用副作用，CLI 注入空实现
  workerExecution: WorkerPoolExecution; // workerExecution 是入口层注入的任务执行模式契约
}

/**
 * CoreServices 是 GUI API Gateway 与 CLI job 共享的服务组合根。
 */
export class CoreServices {
  public readonly paths: AppPathService;
  public readonly metadata: AppMetadataService;
  public readonly app_setting_service: AppSettingService;
  public readonly database: ProjectDatabase;
  public readonly log_manager: LogManager;
  public readonly project_session_state = new ProjectSessionState(); // 当前 loaded 工程会话只在 Core 内部流转
  public readonly task_runtime_state = new TaskRuntimeState(); // 任务运行态供 API 查询、CLI 等待和 mutation gate 共享
  public readonly project_runtime_projection_service: ProjectRuntimeProjectionService;
  public readonly core_event_hub = new CoreEventHub(); // 本地事件流统一服务 GUI SSE 与 Core 内部广播
  public readonly project_change_publisher: ProjectChangePublisher;
  public readonly model_service: ModelService;
  public readonly project_lifecycle_service: ProjectLifecycleService;
  public readonly project_operation_gate: ProjectOperationGate;
  public readonly project_service: ProjectSyncMutationService;
  public readonly proofreading_service: ProofreadingService;
  public readonly task_snapshot_builder: TaskSnapshotBuilder;
  public readonly task_runtime_publisher: TaskRuntimePublisher;
  public readonly project_task_store: ProjectTaskStore;
  public readonly task_engine: TaskEngine;
  public readonly task_service: TaskService;
  public readonly project_reset_preview_service: ProjectResetPreviewService;
  public readonly file_preview_service: FilePreviewService;
  public readonly file_export_service: FileExportService;
  public readonly quality_service: QualityService;
  private readonly task_worker_pool: WorkerPool; // worker pool 必须跟随 CoreServices 释放，避免 CLI 任务结束后残留线程
  private started = false; // started 防止事件 hub 被重复 start/stop 打乱订阅者状态

  /**
   * 组合全部 Core 服务，业务服务之间的依赖只在这里成形。
   */
  public constructor(options: CoreServicesOptions) {
    this.paths = options.paths;
    this.metadata = options.metadata;
    this.app_setting_service = options.appSettingService;
    this.database = options.database;
    this.log_manager = options.logManager;
    this.project_runtime_projection_service = new ProjectRuntimeProjectionService(this.database);
    const project_change_adapter = new ProjectChangeEventAdapter(
      this.database,
      this.project_session_state,
      this.project_runtime_projection_service,
    );
    this.project_change_publisher = new ProjectChangePublisher(
      project_change_adapter,
      this.core_event_hub,
    );
    this.model_service = new ModelService(
      this.paths,
      this.app_setting_service,
      this.metadata.build_linguagacha_user_agent(),
      this.log_manager,
    );
    this.project_lifecycle_service = new ProjectLifecycleService(
      this.database,
      this.project_session_state,
      this.app_setting_service,
      this.paths,
      this.log_manager,
    );
    this.project_operation_gate = new ProjectOperationGate(this.task_runtime_state);
    this.project_service = new ProjectSyncMutationService(
      this.database,
      this.project_operation_gate,
      this.project_session_state,
      this.project_change_publisher,
      this.app_setting_service,
    );
    this.proofreading_service = new ProofreadingService(
      this.database,
      this.project_session_state,
      this.project_change_publisher,
    );
    this.task_snapshot_builder = new TaskSnapshotBuilder(
      this.database,
      this.task_runtime_state,
      this.project_session_state,
      this.project_runtime_projection_service,
    );
    this.task_runtime_publisher = new TaskRuntimePublisher(
      this.core_event_hub,
      this.task_runtime_state,
      this.task_snapshot_builder,
    );
    this.project_task_store = new ProjectTaskStore(
      this.database,
      this.project_session_state,
      this.task_runtime_state,
      this.project_change_publisher,
    );
    this.task_worker_pool = new WorkerPool({
      appRoot: this.paths.get_app_root(),
      execution: options.workerExecution,
    });
    this.task_engine = new TaskEngine({
      appRoot: this.paths.get_app_root(),
      taskStore: this.project_task_store,
      taskRuntimePublisher: this.task_runtime_publisher,
      executorClient: this.task_worker_pool,
      tokenCounter: create_o200k_base_token_counter(),
      AppSettingService: this.app_setting_service,
      logManager: this.log_manager,
    });
    this.task_service = new TaskService(
      this.task_engine,
      this.task_snapshot_builder,
      this.task_runtime_publisher,
      this.project_operation_gate,
      this.project_session_state,
      this.app_setting_service,
    );
    this.project_reset_preview_service = new ProjectResetPreviewService(
      this.database,
      this.task_runtime_state,
      this.project_session_state,
    );
    this.file_preview_service = new FilePreviewService(this.app_setting_service);
    this.file_export_service = new FileExportService(
      this.database,
      this.app_setting_service,
      this.project_session_state,
      options.openOutputFolder,
      this.log_manager,
    );
    this.quality_service = new QualityService(
      this.paths,
      this.app_setting_service,
      this.database,
      this.project_session_state,
      this.project_change_publisher,
    );
  }

  /**
   * 启动事件 hub，并让设置服务把 settings.changed 发布到同一条事件链路。
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.core_event_hub.start();
    this.app_setting_service.set_event_publisher(this.core_event_hub);
  }

  /**
   * 释放 CoreServices 自己持有的运行期资源；数据库和日志由 Bootstrap 关闭。
   */
  public async dispose(): Promise<void> {
    this.app_setting_service.set_event_publisher(null);
    this.core_event_hub.stop();
    await this.task_worker_pool.dispose();
    this.started = false;
  }

  /**
   * API 错误文案跟随当前应用语言，CLI 和 GUI 共用同一 i18n 解析口径。
   */
  public resolve_api_text(): TextResolver {
    return create_text_resolver(
      resolve_i18n_locale(this.app_setting_service.read_setting()["app_language"]),
    );
  }

  /**
   * 按当前 loaded 工程生成 revision 锁，供 CLI 直接启动任务时复用 API 校验语义。
   */
  public build_expected_section_revisions(sections: string[]): Record<string, number> {
    const revisions: Record<string, number> = {};
    for (const section of sections) {
      revisions[section] = this.task_snapshot_builder.get_runtime_section_revision(section);
    }
    return revisions;
  }
}
