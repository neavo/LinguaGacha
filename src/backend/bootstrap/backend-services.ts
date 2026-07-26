import { AppMetadataService } from "../app/app-metadata-service";
import { CacheManager } from "../cache/cache-manager";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { read_json_record } from "../../domain/json";
import { ProjectDatabase, type ProjectDatabaseWrite } from "../database/database-operations";
import { TaskEngine } from "../engine/core/engine";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import { PlanningWorkerPool } from "../engine/planning/planning-worker-pool";
import { BackendWorkerClient } from "../worker/worker-client";
import { TaskPlanner } from "../engine/planning/task-planner";
import { TaskRunPublisher } from "../engine/run/task-run-publisher";
import { TaskRunState } from "../engine/run/task-run-state";
import { TaskSnapshotBuilder } from "../engine/run/task-snapshot-builder";
import { ProjectTaskStore } from "../engine/store/project-task-store";
import { WorkUnitWorkerPool } from "../engine/work-unit/work-unit-worker-pool";
import { ApiStreamHub, type ApiStreamPayload } from "../api/api-stream-hub";
import {
  TranslationFileExportService,
  type OutputFolderOpener,
} from "../translation/translation-file-export-service";
import { FilePreviewService } from "../file/file-preview-service";
import { LogManager } from "../log/log-manager";
import { ModelService } from "../model/model-service";
import { ProjectChangeEventAdapter, type ProjectChangePublisher } from "../project/project-changes";
import { ProjectWriteStore } from "../project/project-write-store";
import { ProjectLifecycleService } from "../project/project-session";
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
import { ToolboxTsConversionExportService } from "../toolbox/toolbox-ts-conversion-export-service";
import { resolve_app_locale } from "../../domain/app-language";
import { create_text_resolver, type TextResolver } from "../../shared/i18n";
import { PROJECT_CHANGE_EVENT_TOPIC } from "../../shared/project-event";
import type { SystemProxySnapshot } from "../network/system-proxy-dispatcher";

export interface BackendServicesOptions {
  paths: AppPathService; // 启动阶段解析出的应用根与数据根权威
  metadata: AppMetadataService; // 只读应用版本和 User-Agent，不参与运行态写入
  appSettingService: AppSettingService; // 配置文件唯一读写入口
  database: ProjectDatabase; // 由 Bootstrap 持有并负责关闭，服务层只组合业务能力
  logManager: LogManager; // Backend 内部日志和任务日志的唯一汇聚点
  systemProxySnapshot: SystemProxySnapshot | null; // 启动期系统代理事实，传给 LLM worker 线程复用
  openOutputFolder: OutputFolderOpener; // GUI 专用副作用，CLI 注入空实现
  workerExecution: BackendWorkerExecution; // 入口层注入的 Backend worker 执行配置
}

/**
 * 应用基础服务分组，供 Gateway 和 CLI 从同一组合根读取路径、元数据与设置。
 */
export interface BackendAppServices {
  paths: AppPathService;
  metadata: AppMetadataService;
  settings: AppSettingService;
}

export interface BackendModelServices {
  service: ModelService;
}

export interface BackendProjectServices {
  lifecycle: ProjectLifecycleService;
  data: ProjectDataReader;
  sessionState: ProjectSessionState;
}

export interface BackendWorkbenchServices {
  query: WorkbenchQueryService;
  commands: WorkbenchService;
  resetPreview: ProjectResetPreviewService;
  filePreview: FilePreviewService;
}

export interface BackendProofreadingServices {
  query: ProofreadingQueryService;
  commands: ProofreadingService;
}

export interface BackendQualityServices {
  service: QualityService;
  statistics: QualityStatisticsService;
}

export interface BackendTranslationServices {
  files: TranslationFileExportService;
}

export interface BackendToolboxServices {
  tsConversion: ToolboxTsConversionExportService;
}

export interface BackendEngineServices {
  tasks: TaskService;
}

export interface BackendLogServices {
  manager: LogManager;
}

export interface BackendStreamServices {
  api: ApiStreamHub;
}

/**
 * GUI API Gateway 与 CLI job 共享的服务组合根，统一装配状态拥有者和跨域依赖。
 */
export class BackendServices {
  private readonly app_setting_service: AppSettingService;
  private readonly database: ProjectDatabase;
  private readonly log_manager: LogManager;
  private readonly api_stream_hub = new ApiStreamHub(); // 公开 stream 服务 GUI SSE、CLI task snapshot 与 settings/logs topic
  private readonly cache_manager: CacheManager;
  private readonly backend_worker_client: BackendWorkerClient;
  private readonly task_snapshot_builder: TaskSnapshotBuilder;
  public readonly app: BackendAppServices;
  public readonly models: BackendModelServices;
  public readonly project: BackendProjectServices;
  public readonly workbench: BackendWorkbenchServices;
  public readonly proofreading: BackendProofreadingServices;
  public readonly quality: BackendQualityServices;
  public readonly translation: BackendTranslationServices;
  public readonly toolbox: BackendToolboxServices;
  public readonly engine: BackendEngineServices;
  public readonly logs: BackendLogServices;
  public readonly streams: BackendStreamServices;
  private readonly work_unit_worker_pool: WorkUnitWorkerPool; // 执行 LLM work unit，生命周期跟随 BackendServices
  private readonly planning_worker_pool: PlanningWorkerPool; // 只承担精确 token 计数，生命周期跟随 BackendServices
  private started = false; // 防止事件 hub 被重复 start/stop 打乱订阅者状态

  /**
   * 组合全部 Backend 服务，业务服务之间的依赖只在这里成形。
   */
  public constructor(options: BackendServicesOptions) {
    const paths = options.paths;
    const metadata = options.metadata;
    const project_session_state = new ProjectSessionState();
    const task_run_state = new TaskRunState();
    this.app_setting_service = options.appSettingService;
    this.database = options.database;
    this.log_manager = options.logManager;
    const project_data_reader = new ProjectDataReader(this.database);
    this.backend_worker_client = new BackendWorkerClient({
      execution: options.workerExecution,
    });
    this.cache_manager = new CacheManager({
      database: this.database,
      logManager: this.log_manager,
      appSettingService: this.app_setting_service,
      workerClient: this.backend_worker_client,
    });
    const handle_project_event = this.cache_manager.handleProjectEvent.bind(this.cache_manager);
    const project_change_adapter = new ProjectChangeEventAdapter(
      this.database,
      project_session_state,
      project_data_reader,
    );
    const project_change_publisher: ProjectChangePublisher = (payload) => {
      const event = project_change_adapter.adapt_project_change(payload);
      if (event !== null) {
        this.api_stream_hub.publish(
          PROJECT_CHANGE_EVENT_TOPIC,
          event as unknown as ApiStreamPayload,
        );
      }
      return event;
    };
    const project_write_store = new ProjectWriteStore(
      this.database,
      handle_project_event,
      project_change_publisher,
    );
    const workbench_query_service = new WorkbenchQueryService(
      project_session_state,
      this.cache_manager,
    );
    const proofreading_query_service = new ProofreadingQueryService({
      sessionState: project_session_state,
      cache: this.cache_manager.proofreading,
    });
    const quality_statistics_service = new QualityStatisticsService({
      sessionState: project_session_state,
      cache: this.cache_manager.qualityStatistics,
    });
    const model_service = new ModelService(
      paths,
      this.app_setting_service,
      metadata.build_linguagacha_user_agent(),
      this.log_manager,
    );
    const project_lifecycle_service = new ProjectLifecycleService(
      this.database,
      project_session_state,
      this.app_setting_service,
      paths,
      this.log_manager,
      handle_project_event,
    );
    const project_operation_gate = new ProjectOperationGate(task_run_state);
    const workbench_service = new WorkbenchService(
      this.database,
      project_operation_gate,
      project_session_state,
      project_write_store,
      this.app_setting_service,
      undefined,
      this.log_manager,
    );
    const proofreading_service = new ProofreadingService(
      this.database,
      project_session_state,
      project_write_store,
    );
    this.task_snapshot_builder = new TaskSnapshotBuilder(
      this.database,
      task_run_state,
      project_session_state,
      project_data_reader,
    );
    const task_run_publisher = new TaskRunPublisher(
      this.api_stream_hub,
      task_run_state,
      this.task_snapshot_builder,
    );
    const project_task_store = new ProjectTaskStore(
      this.database,
      project_session_state,
      task_run_state,
      this.cache_manager,
      project_write_store,
    );
    this.work_unit_worker_pool = new WorkUnitWorkerPool({
      appRoot: paths.get_app_root(),
      execution: options.workerExecution,
      systemProxySnapshot: options.systemProxySnapshot,
    });
    this.planning_worker_pool = new PlanningWorkerPool({
      execution: options.workerExecution,
    });
    const task_engine = new TaskEngine({
      appRoot: paths.get_app_root(),
      taskStore: project_task_store,
      taskRunPublisher: task_run_publisher,
      executorClient: this.work_unit_worker_pool,
      taskPlanner: new TaskPlanner({
        planningWorkerPool: this.planning_worker_pool,
      }),
      AppSettingService: this.app_setting_service,
      logManager: this.log_manager,
    });
    const task_service = new TaskService(
      task_engine,
      this.task_snapshot_builder,
      task_run_publisher,
      project_operation_gate,
      project_session_state,
    );
    const project_reset_preview_service = new ProjectResetPreviewService(
      this.database,
      task_run_state,
      project_session_state,
    );
    const file_preview_service = new FilePreviewService(this.app_setting_service, this.log_manager);
    const file_export_service = new TranslationFileExportService(
      this.database,
      this.app_setting_service,
      project_session_state,
      options.openOutputFolder,
      this.log_manager,
    );
    const ts_conversion_service = new ToolboxTsConversionExportService({
      sessionState: project_session_state,
      cache: this.cache_manager,
      workerClient: this.backend_worker_client,
      presetReader: new QualityRulePresetReader(paths),
      fileExportService: file_export_service,
    });
    const quality_service = new QualityService(
      paths,
      this.app_setting_service,
      this.database,
      project_session_state,
      project_write_store,
    );
    this.app = {
      paths,
      metadata,
      settings: this.app_setting_service,
    };
    this.models = { service: model_service };
    this.project = {
      lifecycle: project_lifecycle_service,
      data: project_data_reader,
      sessionState: project_session_state,
    };
    this.workbench = {
      query: workbench_query_service,
      commands: workbench_service,
      resetPreview: project_reset_preview_service,
      filePreview: file_preview_service,
    };
    this.proofreading = {
      query: proofreading_query_service,
      commands: proofreading_service,
    };
    this.quality = {
      service: quality_service,
      statistics: quality_statistics_service,
    };
    this.translation = {
      files: file_export_service,
    };
    this.toolbox = {
      tsConversion: ts_conversion_service,
    };
    this.engine = { tasks: task_service };
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
    this.app_setting_service.set_stream_publisher(this.api_stream_hub);
  }

  /**
   * 释放 BackendServices 自己持有的运行期资源；数据库和日志由 Bootstrap 关闭。
   */
  public async dispose(): Promise<void> {
    this.app_setting_service.set_stream_publisher(null);
    this.api_stream_hub.stop();
    await Promise.all([
      this.work_unit_worker_pool.dispose(),
      this.planning_worker_pool.dispose(),
      this.backend_worker_client.dispose(),
    ]);
    this.started = false;
  }

  /**
   * API 错误文案跟随当前应用语言，CLI 和 GUI 共用同一 i18n 解析口径。
   */
  public resolve_api_text(): TextResolver {
    return create_text_resolver(
      resolve_app_locale(this.app_setting_service.read_setting()["app_language"]),
    );
  }

  /**
   * 按当前 loaded 工程生成 revision 锁，供 CLI 直接启动任务时复用 API 校验语义。
   */
  public build_expected_section_revisions(sections: string[]): Record<string, number> {
    const revisions: Record<string, number> = {};
    for (const section of sections) {
      revisions[section] = this.task_snapshot_builder.get_section_revision(section);
    }
    return revisions;
  }

  /**
   * CLI 资源写入复用 Backend 内部数据库和 committed event 链路，不向 CLI 暴露底层资源。
   */
  public async commit_cli_resource_writes(
    project_path: string,
    writes: ProjectDatabaseWrite[],
  ): Promise<void> {
    if (writes.length === 0) {
      return;
    }
    this.database.transaction(project_path, () => {
      for (const write of writes) {
        write(this.database);
      }
    });
    const meta = this.database.get_all_meta(project_path);
    const section_revisions = build_section_revisions_from_meta(read_json_record(meta));
    await this.cache_manager.handleProjectEvent({
      type: "project.quality.changed",
      projectPath: project_path,
      source: "cli",
      affectedSections: ["quality", "prompts"],
      sectionRevisions: section_revisions,
      scope: "quality-full",
    });
    await this.cache_manager.handleProjectEvent({
      type: "project.prompts.changed",
      projectPath: project_path,
      source: "cli",
      affectedSections: ["quality", "prompts"],
      sectionRevisions: section_revisions,
      scope: "prompts-full",
    });
  }
}
