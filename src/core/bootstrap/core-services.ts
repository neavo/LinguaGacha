import { AppMetadataService } from "../app/app-metadata-service";
import { AppEventBus } from "../app/app-event-bus";
import { AppSessionCache } from "../app/app-session-cache";
import { AppSessionProofreadingCache } from "../app/app-session-proofreading-cache";
import type { AppEventType } from "../app/app-events";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import { TaskEngine } from "../engine/core/engine";
import type { CoreWorkerExecution } from "../worker/core-worker-execution";
import { PlanningWorkerPool } from "../engine/planning/planning-worker-pool";
import { ProjectReadModelWorkerPool } from "../project/read-model/worker/project-read-model-worker-pool";
import { TaskPlanner } from "../engine/planning/task-planner";
import { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { ProjectTaskStore } from "../engine/store/project-task-store";
import { WorkUnitWorkerPool } from "../engine/work-unit/work-unit-worker-pool";
import { ApiStreamHub } from "../api/api-stream-hub";
import { FileExportService, type OutputFolderOpener } from "../file/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import { ModelService } from "../model/model-service";
import { ProjectChangeEventAdapter } from "../project/project-change-event-adapter";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { NameFieldExtractionReadModelService } from "../project/read-model/name-field-extraction-read-model-service";
import { ProjectOperationGate } from "../project/project-operation-gate";
import { ProjectQueryService } from "../project/project-query-service";
import { ProofreadingQueryService } from "../project/proofreading/proofreading-query-service";
import { ProofreadingQueryWorker } from "../project/proofreading/proofreading-query-worker";
import { QualityStatisticsReadModelService } from "../project/read-model/quality-statistics-read-model-service";
import { ProjectResetPreviewService } from "../project/project-reset-preview-service";
import { ProjectRuntimeProjectionService } from "../project/project-runtime-projection-service";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectSyncMutationService } from "../project/project-sync-mutation-service";
import { ProofreadingService } from "../service/proofreading-service";
import { QualityRulePresetReader } from "../service/quality-rule-preset-reader";
import { QualityService } from "../service/quality-service";
import { TaskService } from "../service/task-service";
import { TsConversionService } from "../service/ts-conversion-service";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";
import type { SystemProxySnapshot } from "./system-proxy-dispatcher";

export interface CoreServicesOptions {
  paths: AppPathService; // paths 是启动阶段解析出的应用根与数据根权威
  metadata: AppMetadataService; // metadata 只读应用版本和 User-Agent，不参与运行态写入
  appSettingService: AppSettingService; // appSettingService 是配置文件唯一读写入口
  database: ProjectDatabase; // database 由 Bootstrap 持有并负责关闭，服务层只组合业务能力
  logManager: LogManager; // logManager 是 Core 内部日志和任务日志的唯一汇聚点
  systemProxySnapshot: SystemProxySnapshot | null; // systemProxySnapshot 是启动期系统代理事实，传给 LLM worker 线程复用
  openOutputFolder: OutputFolderOpener; // openOutputFolder 是 GUI 专用副作用，CLI 注入空实现
  workerExecution: CoreWorkerExecution; // workerExecution 是入口层注入的 Core worker 执行配置
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
  public readonly api_stream_hub = new ApiStreamHub(); // 公开 stream 服务 GUI SSE、CLI task snapshot 与 settings/logs topic
  public readonly app_event_bus = new AppEventBus(); // Core 内部 committed event 总线，不直接暴露给 renderer
  public readonly app_session_cache: AppSessionCache;
  public readonly project_change_publisher: ProjectChangePublisher;
  public readonly project_query_service: ProjectQueryService;
  public readonly project_read_model_worker_pool: ProjectReadModelWorkerPool;
  public readonly proofreading_query_worker: ProofreadingQueryWorker;
  public readonly app_session_proofreading_cache: AppSessionProofreadingCache;
  public readonly proofreading_query_service: ProofreadingQueryService;
  public readonly quality_statistics_read_model_service: QualityStatisticsReadModelService;
  public readonly name_field_extraction_read_model_service: NameFieldExtractionReadModelService;
  public readonly ts_conversion_service: TsConversionService;
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
  private readonly work_unit_worker_pool: WorkUnitWorkerPool; // work_unit_worker_pool 执行 LLM work unit，生命周期跟随 CoreServices
  private readonly planning_worker_pool: PlanningWorkerPool; // planning_worker_pool 只承担精确 token 计数，生命周期跟随 CoreServices
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
    this.app_session_cache = new AppSessionCache(this.database, this.log_manager);
    this.subscribe_app_session_cache();
    this.project_runtime_projection_service = new ProjectRuntimeProjectionService(this.database);
    const project_change_adapter = new ProjectChangeEventAdapter(
      this.database,
      this.project_session_state,
      this.project_runtime_projection_service,
    );
    this.project_change_publisher = new ProjectChangePublisher(
      project_change_adapter,
      this.api_stream_hub,
    );
    this.project_query_service = new ProjectQueryService(
      this.project_session_state,
      this.app_session_cache,
    );
    this.project_read_model_worker_pool = new ProjectReadModelWorkerPool({
      execution: options.workerExecution,
    });
    this.proofreading_query_worker = new ProofreadingQueryWorker({
      execution: options.workerExecution,
    });
    this.app_session_proofreading_cache = new AppSessionProofreadingCache({
      appSessionCache: this.app_session_cache,
      appSettingService: this.app_setting_service,
      worker: this.proofreading_query_worker,
    });
    this.proofreading_query_service = new ProofreadingQueryService({
      sessionState: this.project_session_state,
      cache: this.app_session_proofreading_cache,
    });
    this.quality_statistics_read_model_service = new QualityStatisticsReadModelService({
      sessionState: this.project_session_state,
      appSessionCache: this.app_session_cache,
      workerPool: this.project_read_model_worker_pool,
    });
    this.name_field_extraction_read_model_service = new NameFieldExtractionReadModelService({
      sessionState: this.project_session_state,
      appSessionCache: this.app_session_cache,
      workerPool: this.project_read_model_worker_pool,
    });
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
      this.app_event_bus,
    );
    this.project_operation_gate = new ProjectOperationGate(this.task_runtime_state);
    this.project_service = new ProjectSyncMutationService(
      this.database,
      this.project_operation_gate,
      this.project_session_state,
      this.app_event_bus,
      this.project_change_publisher,
      this.app_setting_service,
      undefined,
      this.log_manager,
    );
    this.proofreading_service = new ProofreadingService(
      this.database,
      this.project_session_state,
      this.app_event_bus,
      this.project_change_publisher,
    );
    this.task_snapshot_builder = new TaskSnapshotBuilder(
      this.database,
      this.task_runtime_state,
      this.project_session_state,
      this.project_runtime_projection_service,
    );
    this.task_runtime_publisher = new TaskRuntimePublisher(
      this.api_stream_hub,
      this.task_runtime_state,
      this.task_snapshot_builder,
    );
    this.project_task_store = new ProjectTaskStore(
      this.database,
      this.project_session_state,
      this.task_runtime_state,
      this.app_session_cache,
      this.project_change_publisher,
      this.app_event_bus,
    );
    this.work_unit_worker_pool = new WorkUnitWorkerPool({
      appRoot: this.paths.get_app_root(),
      execution: options.workerExecution,
      systemProxySnapshot: options.systemProxySnapshot,
    });
    this.planning_worker_pool = new PlanningWorkerPool({
      execution: options.workerExecution,
    });
    this.task_engine = new TaskEngine({
      appRoot: this.paths.get_app_root(),
      taskStore: this.project_task_store,
      taskRuntimePublisher: this.task_runtime_publisher,
      executorClient: this.work_unit_worker_pool,
      taskPlanner: new TaskPlanner({
        planningWorkerPool: this.planning_worker_pool,
      }),
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
    this.file_preview_service = new FilePreviewService(this.app_setting_service, this.log_manager);
    this.file_export_service = new FileExportService(
      this.database,
      this.app_setting_service,
      this.project_session_state,
      options.openOutputFolder,
      this.log_manager,
    );
    this.ts_conversion_service = new TsConversionService({
      sessionState: this.project_session_state,
      appSessionCache: this.app_session_cache,
      workerPool: this.project_read_model_worker_pool,
      presetReader: new QualityRulePresetReader(this.paths),
      fileExportService: this.file_export_service,
    });
    this.quality_service = new QualityService(
      this.paths,
      this.app_setting_service,
      this.database,
      this.project_session_state,
      this.app_event_bus,
      this.project_change_publisher,
    );
  }

  /**
   * 启动 API stream hub，并让设置服务把 settings.changed 发布到同一条公开 stream。
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.api_stream_hub.start();
    this.app_setting_service.set_stream_publisher(this.api_stream_hub);
  }

  /**
   * 释放 CoreServices 自己持有的运行期资源；数据库和日志由 Bootstrap 关闭。
   */
  public async dispose(): Promise<void> {
    this.app_setting_service.set_stream_publisher(null);
    this.api_stream_hub.stop();
    await Promise.all([
      this.work_unit_worker_pool.dispose(),
      this.planning_worker_pool.dispose(),
      this.project_read_model_worker_pool.dispose(),
      this.proofreading_query_worker.dispose(),
    ]);
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

  /**
   * AppSessionCache 订阅所有会影响后端 query view 的 committed event。
   */
  private subscribe_app_session_cache(): void {
    const event_types: AppEventType[] = [
      "project.opened_for_cache",
      "project.unloaded",
      "project.items.changed",
      "project.quality.changed",
      "project.prompts.changed",
      "project.settings.changed",
      "project.analysis.changed",
    ];
    for (const event_type of event_types) {
      this.app_event_bus.subscribe(event_type, async (event) => {
        await this.app_session_cache.handleAppEvent(event);
        if (
          event.type === "project.unloaded" ||
          event.type === "project.items.changed" ||
          event.type === "project.quality.changed" ||
          event.type === "project.settings.changed" ||
          event.type === "project.opened_for_cache"
        ) {
          await this.app_session_proofreading_cache.disposeProject(
            event.type === "project.opened_for_cache" ? undefined : event.projectPath,
          );
          this.quality_statistics_read_model_service.clear();
        }
      });
    }
  }
}
