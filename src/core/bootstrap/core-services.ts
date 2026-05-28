import { AppMetadataService } from "../app/app-metadata-service";
import { ProjectEventBus } from "../project/project-events";
import { ProjectDataCache } from "../project/project-data";
import { ProofreadingCache } from "../proofreading/proofreading-cache";
import type { ProjectEventType } from "../project/project-events";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import { TaskEngine } from "../engine/core/engine";
import type { CoreWorkerExecution } from "../worker/worker-execution";
import { PlanningWorkerPool } from "../engine/planning/planning-worker-pool";
import { CoreWorkerClient } from "../worker/worker-client";
import { TaskPlanner } from "../engine/planning/task-planner";
import { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { ProjectTaskStore } from "../engine/store/project-task-store";
import { WorkUnitWorkerPool } from "../engine/work-unit/work-unit-worker-pool";
import { ApiStreamHub } from "../api/api-stream-hub";
import { FileExportService, type OutputFolderOpener } from "../export/file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import { ModelService } from "../model/model-service";
import { ProjectChangeEventAdapter } from "../project/project-changes";
import { ProjectChangePublisher } from "../project/project-changes";
import { ProjectLifecycleService } from "../project/project-session";
import { NameFieldExtractionService } from "../analysis/name-field-extraction-service";
import { ProjectOperationGate } from "../project/project-gate";
import { WorkbenchQueryService } from "../workbench/workbench-query-service";
import { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import { QualityStatisticsService } from "../quality/quality-statistics-service";
import { ProjectResetPreviewService } from "../workbench/project-reset-preview-service";
import { ProjectDataReader } from "../project/project-data";
import { ProjectSessionState } from "../project/project-session";
import { build_section_revisions_from_meta } from "../project/project-data";
import { WorkbenchService } from "../workbench/workbench-service";
import { ProofreadingService } from "../proofreading/proofreading-service";
import { QualityRulePresetReader } from "../quality/quality-rule-preset-reader";
import { QualityService } from "../quality/quality-service";
import { TaskService } from "../engine/task-service";
import { TsConversionService } from "../export/ts-conversion-service";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";
import { createProofreadingListService } from "../../shared/proofreading/proofreading-read-model";
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
export interface CoreAppServices {
  paths: AppPathService;
  metadata: AppMetadataService;
  settings: AppSettingService;
}

export interface CoreModelServices {
  service: ModelService;
}

export interface CoreProjectServices {
  lifecycle: ProjectLifecycleService;
  data: ProjectDataReader;
  sessionState: ProjectSessionState;
}

export interface CoreWorkbenchServices {
  query: WorkbenchQueryService;
  commands: WorkbenchService;
  resetPreview: ProjectResetPreviewService;
  filePreview: FilePreviewService;
}

export interface CoreProofreadingServices {
  query: ProofreadingQueryService;
  commands: ProofreadingService;
}

export interface CoreQualityServices {
  service: QualityService;
  statistics: QualityStatisticsService;
}

export interface CoreAnalysisServices {
  nameFields: NameFieldExtractionService;
}

export interface CoreExportServices {
  files: FileExportService;
  tsConversion: TsConversionService;
}

export interface CoreEngineServices {
  tasks: TaskService;
}

export interface CoreLogServices {
  manager: LogManager;
}

export interface CoreStreamServices {
  api: ApiStreamHub;
}
export class CoreServices {
  private readonly paths: AppPathService;
  private readonly metadata: AppMetadataService;
  private readonly app_setting_service: AppSettingService;
  private readonly database: ProjectDatabase;
  private readonly log_manager: LogManager;
  private readonly project_session_state = new ProjectSessionState(); // 当前 loaded 工程会话只在 Core 内部流转
  private readonly task_runtime_state = new TaskRuntimeState(); // 任务运行态供 API 查询、CLI 等待和 mutation gate 共享
  private readonly project_data_reader: ProjectDataReader;
  private readonly api_stream_hub = new ApiStreamHub(); // 公开 stream 服务 GUI SSE、CLI task snapshot 与 settings/logs topic
  private readonly project_event_bus = new ProjectEventBus(); // Core 内部 committed event 总线，不直接暴露给 renderer
  private readonly project_data_cache: ProjectDataCache;
  private readonly project_change_publisher: ProjectChangePublisher;
  private readonly workbench_query_service: WorkbenchQueryService;
  private readonly core_worker_client: CoreWorkerClient;
  private readonly proofreading_cache: ProofreadingCache;
  private readonly proofreading_query_service: ProofreadingQueryService;
  private readonly quality_statistics_service: QualityStatisticsService;
  private readonly name_field_extraction_service: NameFieldExtractionService;
  private readonly ts_conversion_service: TsConversionService;
  private readonly model_service: ModelService;
  private readonly project_lifecycle_service: ProjectLifecycleService;
  private readonly project_operation_gate: ProjectOperationGate;
  private readonly workbench_service: WorkbenchService;
  private readonly proofreading_service: ProofreadingService;
  private readonly task_snapshot_builder: TaskSnapshotBuilder;
  private readonly task_runtime_publisher: TaskRuntimePublisher;
  private readonly project_task_store: ProjectTaskStore;
  private readonly task_engine: TaskEngine;
  private readonly task_service: TaskService;
  private readonly project_reset_preview_service: ProjectResetPreviewService;
  private readonly file_preview_service: FilePreviewService;
  private readonly file_export_service: FileExportService;
  private readonly quality_service: QualityService;
  public readonly app: CoreAppServices;
  public readonly models: CoreModelServices;
  public readonly project: CoreProjectServices;
  public readonly workbench: CoreWorkbenchServices;
  public readonly proofreading: CoreProofreadingServices;
  public readonly quality: CoreQualityServices;
  public readonly analysis: CoreAnalysisServices;
  public readonly export: CoreExportServices;
  public readonly engine: CoreEngineServices;
  public readonly logs: CoreLogServices;
  public readonly streams: CoreStreamServices;
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
    this.project_data_cache = new ProjectDataCache(this.database, this.log_manager);
    this.subscribe_project_data_cache();
    this.project_data_reader = new ProjectDataReader(this.database);
    const project_change_adapter = new ProjectChangeEventAdapter(
      this.database,
      this.project_session_state,
      this.project_data_reader,
    );
    this.project_change_publisher = new ProjectChangePublisher(
      project_change_adapter,
      this.api_stream_hub,
    );
    this.workbench_query_service = new WorkbenchQueryService(
      this.project_session_state,
      this.project_data_cache,
    );
    this.core_worker_client = new CoreWorkerClient({
      execution: options.workerExecution,
    });
    this.proofreading_cache = new ProofreadingCache({
      projectDataCache: this.project_data_cache,
      appSettingService: this.app_setting_service,
      workerClient: this.core_worker_client,
      service: createProofreadingListService(),
    });
    this.proofreading_query_service = new ProofreadingQueryService({
      sessionState: this.project_session_state,
      cache: this.proofreading_cache,
    });
    this.quality_statistics_service = new QualityStatisticsService({
      sessionState: this.project_session_state,
      projectDataCache: this.project_data_cache,
      workerClient: this.core_worker_client,
    });
    this.name_field_extraction_service = new NameFieldExtractionService({
      sessionState: this.project_session_state,
      projectDataCache: this.project_data_cache,
      workerClient: this.core_worker_client,
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
      this.project_event_bus,
    );
    this.project_operation_gate = new ProjectOperationGate(this.task_runtime_state);
    this.workbench_service = new WorkbenchService(
      this.database,
      this.project_operation_gate,
      this.project_session_state,
      this.project_event_bus,
      this.project_change_publisher,
      this.app_setting_service,
      undefined,
      this.log_manager,
    );
    this.proofreading_service = new ProofreadingService(
      this.database,
      this.project_session_state,
      this.project_event_bus,
      this.project_change_publisher,
    );
    this.task_snapshot_builder = new TaskSnapshotBuilder(
      this.database,
      this.task_runtime_state,
      this.project_session_state,
      this.project_data_reader,
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
      this.project_data_cache,
      this.project_change_publisher,
      this.project_event_bus,
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
      projectDataCache: this.project_data_cache,
      workerClient: this.core_worker_client,
      presetReader: new QualityRulePresetReader(this.paths),
      fileExportService: this.file_export_service,
    });
    this.quality_service = new QualityService(
      this.paths,
      this.app_setting_service,
      this.database,
      this.project_session_state,
      this.project_event_bus,
      this.project_change_publisher,
    );
    this.app = {
      paths: this.paths,
      metadata: this.metadata,
      settings: this.app_setting_service,
    };
    this.models = { service: this.model_service };
    this.project = {
      lifecycle: this.project_lifecycle_service,
      data: this.project_data_reader,
      sessionState: this.project_session_state,
    };
    this.workbench = {
      query: this.workbench_query_service,
      commands: this.workbench_service,
      resetPreview: this.project_reset_preview_service,
      filePreview: this.file_preview_service,
    };
    this.proofreading = {
      query: this.proofreading_query_service,
      commands: this.proofreading_service,
    };
    this.quality = {
      service: this.quality_service,
      statistics: this.quality_statistics_service,
    };
    this.analysis = { nameFields: this.name_field_extraction_service };
    this.export = {
      files: this.file_export_service,
      tsConversion: this.ts_conversion_service,
    };
    this.engine = { tasks: this.task_service };
    this.logs = { manager: this.log_manager };
    this.streams = { api: this.api_stream_hub };
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
      this.core_worker_client.dispose(),
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
   * CLI 资源写入复用 Core 内部数据库和 committed event 链路，不向 CLI 暴露底层资源。
   */
  public async commit_cli_resource_operations(
    project_path: string,
    operations: DatabaseOperation[],
  ): Promise<void> {
    if (operations.length === 0) {
      return;
    }
    this.database.execute_transaction(operations);
    const meta = this.database.execute({
      name: "getAllMeta",
      args: { projectPath: project_path },
    });
    const section_revisions = build_section_revisions_from_meta(
      typeof meta === "object" && meta !== null && !Array.isArray(meta) ? meta : {},
    );
    await this.project_event_bus.publish({
      type: "project.quality.changed",
      projectPath: project_path,
      source: "cli",
      affectedSections: ["quality", "prompts"],
      sectionRevisions: section_revisions,
      scope: "quality-full",
    });
    await this.project_event_bus.publish({
      type: "project.prompts.changed",
      projectPath: project_path,
      source: "cli",
      affectedSections: ["quality", "prompts"],
      sectionRevisions: section_revisions,
      scope: "prompts-full",
    });
  }
  /**
   * ProjectDataCache 订阅所有会影响后端 query view 的 committed event。
   */
  private subscribe_project_data_cache(): void {
    const event_types: ProjectEventType[] = [
      "project.opened_for_cache",
      "project.unloaded",
      "project.items.changed",
      "project.quality.changed",
      "project.prompts.changed",
      "project.settings.changed",
      "project.analysis.changed",
    ];
    for (const event_type of event_types) {
      this.project_event_bus.subscribe(event_type, async (event) => {
        await this.project_data_cache.handleProjectEvent(event);
        if (
          event.type === "project.unloaded" ||
          event.type === "project.items.changed" ||
          event.type === "project.quality.changed" ||
          event.type === "project.settings.changed" ||
          event.type === "project.opened_for_cache"
        ) {
          await this.proofreading_cache.disposeProject(
            event.type === "project.opened_for_cache" ? undefined : event.projectPath,
          );
          this.quality_statistics_service.clear();
        }
      });
    }
  }
}
