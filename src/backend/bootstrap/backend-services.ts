import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { CacheManager } from "../cache/cache-manager";
import { ProjectDatabase } from "../database/database-operations";
import { BatchTranslationRunner } from "../batch-translation/core/batch-translation-runner";
import { PlanningWorkerPool } from "../batch-translation/planning/planning-worker-pool";
import { TranslationPlanner } from "../batch-translation/planning/translation-planner";
import { BatchTranslationProjectStore } from "../batch-translation/batch-translation-project-store";
import { BatchTranslationRuntime } from "../batch-translation/batch-translation-runtime";
import { BatchTranslationService } from "../batch-translation/batch-translation-service";
import { TranslationWorkerPool } from "../batch-translation/work-unit/translation-worker-pool";
import { FilePreviewService } from "../file/file-preview-service";
import { TsConversionExportService } from "../file/ts-conversion-export-service";
import {
  TranslationFileExportService,
  type OutputFolderOpener,
} from "../file/translation-file-export-service";
import { LogManager } from "../log/log-manager";
import { LLMClient } from "../llm/llm-client";
import { ModelService } from "../model/model-service";
import { ProjectContentService } from "../project/project-content-service";
import { create_project_change_publisher } from "../project/project-write-event-adapter";
import { ProjectDataReader } from "../project/project-data-reader";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { ProjectResetPreviewService } from "../project/project-reset-preview-service";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectSummaryService } from "../project/project-summary-service";
import { ProjectWriteStore } from "../project/project-write-store";
import { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import { ProofreadingService } from "../proofreading/proofreading-service";
import { QualityPromptService } from "../quality/quality-prompt-service";
import { QualityRuleService } from "../quality/quality-rule-service";
import { QualityStatisticsService } from "../quality/quality-statistics-service";
import { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import type { JsonRecord } from "../../domain/json";
import { PROJECT_CHANGE_EVENT_TOPIC } from "../../shared/project-event";
import {
  RUNTIME_ACTIVITY_EVENT_TOPIC,
  type RuntimeActivitySnapshot,
} from "../../shared/runtime-activity";

const BATCH_TRANSLATION_SNAPSHOT_EVENT_TOPIC = "batch_translation.snapshot_changed";

export interface BackendServicesOptions {
  paths: AppPathService; // 启动阶段解析出的应用根与数据根权威
  metadata: AppMetadataService; // 只读应用版本和 User-Agent，不参与运行态写入
  appSettingService: AppSettingService; // 配置文件唯一读写入口
  database: ProjectDatabase; // 由 Bootstrap 持有并负责关闭，服务层只组合业务能力
  logManager: LogManager; // Backend 内部日志和任务日志的唯一汇聚点
  publishEvent: (topic: string, payload: JsonRecord) => void; // 入口层选择公开传输或无输出；业务服务不依赖 SSE
  openOutputFolder: OutputFolderOpener; // GUI 专用副作用，CLI 注入空实现
  workerExecution: BackendWorkerExecution; // 入口层注入的 Backend worker 执行配置
}

/** GUI 扩展与共享业务服务必须引用同一组状态拥有者。 */
export interface BackendServiceState {
  session: ProjectSessionState;
  runtimeGate: RuntimeOperationGate;
  cache: CacheManager;
  writes: ProjectWriteStore;
}

export interface BackendAppServices {
  paths: AppPathService;
  metadata: AppMetadataService;
  settings: AppSettingService;
  updateSettings: (request: JsonRecord) => JsonRecord; // 设置 API 的统一运行时门禁入口
}

export interface BackendRuntimeServices {
  getSnapshot: () => { runtime: RuntimeActivitySnapshot }; // API 不接触 gate lease
}

export interface BackendProjectServices {
  lifecycle: ProjectLifecycleService;
  readManifest: () => JsonRecord;

  summary: ProjectSummaryService;
  content: ProjectContentService;
  resetPreview: ProjectResetPreviewService;
}

export interface BackendProofreadingServices {
  query: ProofreadingQueryService;
  commands: ProofreadingService;
}

export interface BackendQualityServices {
  rules: QualityRuleService;
  prompts: QualityPromptService;
  statistics: QualityStatisticsService;
}

export interface BackendFileServices {
  preview: FilePreviewService;
  translationExport: TranslationFileExportService;
  tsConversionExport: TsConversionExportService;
}

/**
 * GUI 与 CLI 共享的业务服务组合根；状态拥有者只在这里装配。
 */
export class BackendServices {
  private readonly app_setting_service: AppSettingService;
  private readonly cache_manager: CacheManager;
  private readonly compute_worker_client: ComputeWorkerClient;
  private readonly task_runtime: BatchTranslationRuntime;
  private readonly runtime_gate = new RuntimeOperationGate(); // task、GUI Agent 与结构性写入共享的唯一门禁
  private readonly work_unit_worker_pool: TranslationWorkerPool;
  private readonly planning_worker_pool: PlanningWorkerPool;
  private task_stream_unsubscribe: (() => void) | null;
  private runtime_stream_unsubscribe: (() => void) | null; // dispose 时停止发布已关闭业务根的事件

  public readonly app: BackendAppServices;
  public readonly runtime: BackendRuntimeServices;
  public readonly project: BackendProjectServices;
  public readonly proofreading: BackendProofreadingServices;
  public readonly quality: BackendQualityServices;
  public readonly files: BackendFileServices;
  public readonly model: ModelService;
  public readonly batchTranslation: BatchTranslationService;
  public readonly logManager: LogManager;
  public readonly state: BackendServiceState;

  /**
   * 只在这里装配状态拥有者与服务依赖，调用方不得二次 new 同类服务。
   */
  public constructor(options: BackendServicesOptions) {
    const paths = options.paths;
    const metadata = options.metadata;
    const user_agent = metadata.build_linguagacha_user_agent();
    const session_state = new ProjectSessionState();
    const data_reader = new ProjectDataReader(options.database);

    this.app_setting_service = options.appSettingService;
    this.logManager = options.logManager;
    const llm_client = new LLMClient({ userAgent: user_agent });
    this.compute_worker_client = new ComputeWorkerClient({
      execution: options.workerExecution,
    });
    this.cache_manager = new CacheManager({
      database: options.database,
      logManager: this.logManager,
      appSettingService: this.app_setting_service,
      workerClient: this.compute_worker_client,
    });
    const handle_project_event = this.cache_manager.handleProjectEvent.bind(this.cache_manager);
    const adapt_project_change = create_project_change_publisher(options.database, session_state);
    const publish_project_change = (request: Parameters<typeof adapt_project_change>[0]) => {
      const event = adapt_project_change(request);
      if (event !== null) {
        options.publishEvent(PROJECT_CHANGE_EVENT_TOPIC, event as unknown as JsonRecord);
      }
      return event;
    };
    const write_store = new ProjectWriteStore(
      options.database,
      handle_project_event,
      publish_project_change,
    );

    this.task_runtime = new BatchTranslationRuntime(session_state, data_reader, this.runtime_gate);
    const lifecycle = new ProjectLifecycleService(
      options.database,
      this.runtime_gate,
      session_state,
      this.app_setting_service,
      paths,
      this.logManager,
      handle_project_event,
      write_store,
    );
    const translation_export = new TranslationFileExportService(
      options.database,
      this.app_setting_service,
      session_state,
      options.openOutputFolder,
      this.logManager,
    );

    this.work_unit_worker_pool = new TranslationWorkerPool({
      builtinRoot: paths.get_builtin_root(),
      execution: options.workerExecution,
      llmClient: llm_client,
    });
    this.planning_worker_pool = new PlanningWorkerPool({
      execution: options.workerExecution,
    });
    const task_engine = new BatchTranslationRunner({
      builtinRoot: paths.get_builtin_root(),
      taskStore: new BatchTranslationProjectStore(
        options.database,
        session_state,
        this.cache_manager,
        write_store,
      ),
      taskRuntime: this.task_runtime,
      executorClient: this.work_unit_worker_pool,
      taskPlanner: new TranslationPlanner({
        planningWorkerPool: this.planning_worker_pool,
      }),
      AppSettingService: this.app_setting_service,
      logManager: this.logManager,
    });

    this.app = {
      paths,
      metadata,
      settings: this.app_setting_service,
      // 设置持久化是同步操作，检查与提交之间不会让出事件循环。
      updateSettings: (request) => {
        this.runtime_gate.assert_runtime_idle();
        return this.app_setting_service.update_app_settings(request);
      },
    };
    this.runtime = {
      // 只暴露公开快照，不把 gate 或 lease 交给 API 层。
      getSnapshot: () => ({ runtime: this.runtime_gate.get_snapshot() }),
    };
    this.project = {
      lifecycle,
      readManifest: () => data_reader.build_manifest(session_state.snapshot()),

      summary: new ProjectSummaryService(session_state, this.cache_manager),
      content: new ProjectContentService(
        options.database,
        this.runtime_gate,
        session_state,
        write_store,
        this.app_setting_service,
        undefined,
        this.logManager,
      ),
      resetPreview: new ProjectResetPreviewService(
        options.database,
        this.runtime_gate,
        session_state,
      ),
    };
    this.proofreading = {
      query: new ProofreadingQueryService({
        sessionState: session_state,
        cache: this.cache_manager.proofreading,
      }),
      commands: new ProofreadingService(
        options.database,
        this.runtime_gate,
        session_state,
        write_store,
      ),
    };
    const quality_rules = new QualityRuleService(
      paths,
      session_state,
      write_store,
      this.runtime_gate,
      this.cache_manager,
    );
    this.quality = {
      rules: quality_rules,
      prompts: new QualityPromptService(
        paths,
        this.app_setting_service,
        options.database,
        session_state,
        write_store,
        this.runtime_gate,
        this.cache_manager,
      ),
      statistics: new QualityStatisticsService({
        sessionState: session_state,
        cache: this.cache_manager.qualityStatistics,
      }),
    };
    this.files = {
      preview: new FilePreviewService(this.app_setting_service, this.logManager),
      translationExport: translation_export,
      tsConversionExport: new TsConversionExportService({
        sessionState: session_state,
        cache: this.cache_manager,
        workerClient: this.compute_worker_client,
        fileExportService: translation_export,
      }),
    };
    this.model = new ModelService(
      paths,
      this.app_setting_service,
      llm_client,
      this.runtime_gate,
      this.logManager,
    );
    this.batchTranslation = new BatchTranslationService(
      task_engine,
      this.task_runtime,
      session_state,
    );
    this.state = {
      session: session_state,
      runtimeGate: this.runtime_gate,
      cache: this.cache_manager,
      writes: write_store,
    };
    this.task_stream_unsubscribe = this.batchTranslation.subscribe((snapshot) => {
      options.publishEvent(BATCH_TRANSLATION_SNAPSHOT_EVENT_TOPIC, {
        batch_translation: snapshot as unknown as JsonRecord,
      });
    });
    this.runtime_stream_unsubscribe = this.runtime_gate.subscribe((snapshot) => {
      options.publishEvent(RUNTIME_ACTIVITY_EVENT_TOPIC, {
        runtime: snapshot,
      });
    });
  }

  /**
   * 释放组合根拥有的运行态资源；数据库和日志由 Bootstrap 关闭。
   */
  public async dispose(): Promise<void> {
    this.task_stream_unsubscribe?.();
    this.task_stream_unsubscribe = null;
    this.runtime_stream_unsubscribe?.();
    this.runtime_stream_unsubscribe = null;
    const errors: unknown[] = [];
    try {
      await this.task_runtime.dispose();
    } catch (error) {
      errors.push(error);
    }
    const worker_results = await Promise.allSettled([
      this.work_unit_worker_pool.dispose(),
      this.planning_worker_pool.dispose(),
      this.compute_worker_client.dispose(),
    ]);
    for (const result of worker_results) {
      if (result.status === "rejected") {
        errors.push(result.reason);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close BackendServices resources.");
    }
  }
}
