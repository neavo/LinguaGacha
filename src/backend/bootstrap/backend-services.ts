import { randomUUID } from "node:crypto";
import path from "node:path";
import { default_native_fs } from "../../native/native-fs";
import { AppError } from "../../shared/error";
import type { ProjectTaskInput } from "../project/project-task-input";
import { ProjectRegistry } from "../project/project-registry";
import { BatchRequestService } from "../batch-request/batch-request-service";
import { BatchTaskRuntime } from "../batch-task/batch-task-runtime";
import { RequestRatePool } from "../batch-task/request-rate";
import { ProjectKnowledgeService } from "../project/project-knowledge-service";
import { GameDirectoryOperations } from "../file/shared/game/game-directory-operations";
import { configure_python_parser } from "../file/renpy/python-syntax";
import { GamePrepareWorker } from "../file/shared/game/prepare-worker";
import { GameFontService } from "../file/game-font-service";
import { configure_rgss_parser } from "../file/rpgmaker-rgss/ruby";
import { configure_javascript_parser } from "../file/shared/javascript";
import type { SettingsUpdateResponse } from "../../shared/settings";
import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingsCommandService } from "../app/app-settings-command-service";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectCache } from "../cache/project-cache";
import { ProjectDatabase } from "../database/database-operations";
import { BatchTranslationRunner } from "../batch-translation/core/batch-translation-runner";
import { PlanningWorkerPool } from "../batch-translation/planning/planning-worker-pool";
import { TranslationPlanner } from "../batch-translation/planning/translation-planner";
import { BatchTranslationProjectStore } from "../batch-translation/batch-translation-project-store";
import { BatchTranslationState } from "../batch-translation/batch-translation-state";
import { BatchTranslationService } from "../batch-translation/batch-translation-service";
import { TranslationWorkerPool } from "../batch-translation/work-unit/translation-worker-pool";
import {
  TranslationFileGenerationService,
  type OutputFolderOpener,
} from "../file/translation-file-generation-service";
import { LogManager } from "../log/log-manager";
import { LLMClient } from "../llm/llm-client";
import { PiModelCatalog } from "../llm/pi-model-catalog";
import { ModelService } from "../model/model-service";
import { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import { ProjectContentService } from "../project/project-content-service";
import { adapt_project_change } from "../project/project-write-event-adapter";
import {
  ProjectDataReader,
  build_section_revisions_from_meta,
  type ProjectDataSnapshot,
} from "../project/project-data-reader";
import { GlobalOperationGate, ProjectOperationGate } from "../runtime-operation-gate";
import { ProjectLifecycleService } from "../project/project-lifecycle-service";
import { ProjectSummaryService } from "../project/project-summary-service";
import { ProjectTranslationTransferService } from "../project/project-translation-transfer-service";
import { ProjectWriteStore } from "../project/project-write-store";
import { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import { ProofreadingService } from "../proofreading/proofreading-service";
import { QualityPromptService } from "../quality/quality-prompt-service";
import { QualityRuleService } from "../quality/quality-rule-service";
import { QualityStatisticsService } from "../quality/quality-statistics-service";
import { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { PROJECT_CHANGE_EVENT_TOPIC } from "../../shared/project-event";
import { MODEL_CATALOG_UPDATED_EVENT_TOPIC } from "../../shared/model-catalog";
import {
  RUNTIME_ACTIVITY_EVENT_TOPIC,
  type RuntimeActivitySnapshot,
} from "../../shared/runtime-activity";

const BATCH_TASK_SNAPSHOT_EVENT_TOPIC = "batch_task.snapshot_changed";

export interface BackendServicesOptions {
  workspaceRuntimeDirectory?: string; // 入口注入的工作区运行目录

  paths: AppPathService; // 启动阶段解析出的应用根与数据根权威
  metadata: AppMetadataService; // 只读应用版本和 User-Agent，不参与运行态写入
  appSettingService: AppSettingService; // 配置文件唯一读写入口
  database: ProjectDatabase; // 由 Bootstrap 持有并负责关闭，服务层只组合业务能力
  logManager: LogManager; // Backend 内部日志和任务日志的唯一汇聚点
  publishEvent: (topic: string, payload: JsonRecord) => void; // 公开事件的传输方式归入口层选择。
  openOutputFolder: OutputFolderOpener; // GUI 专用副作用，CLI 注入空实现
  workerExecution: BackendWorkerExecution; // 入口层注入的 Backend worker 执行配置
}

export interface BackendAppServices {
  paths: AppPathService;
  metadata: AppMetadataService;
  settings: AppSettingService;
  updateSettings: (request: JsonRecord) => Promise<SettingsUpdateResponse>; // 设置命令统一编排工程同步与补偿
}

export interface BackendRuntimeServices {
  getSnapshot: () => { runtime: RuntimeActivitySnapshot }; // API 不接触 gate lease
}

type ProjectAgentLifecycle = {
  cancel_uploads(): void;
  dispose(): Promise<void>;
};
export type OpenProject<Agent extends ProjectAgentLifecycle = ProjectAgentLifecycle> = {
  id: string;
  path: string;
  gate: ProjectOperationGate;
  cache: ProjectCache;
  writes: ProjectWriteStore;
  knowledge: ProjectKnowledgeService;
  summary: ProjectSummaryService;
  content: ProjectContentService;
  proofreading: { query: ProofreadingQueryService; commands: ProofreadingService };
  quality: {
    rules: QualityRuleService;
    prompts: QualityPromptService;
    statistics: QualityStatisticsService;
  };
  generation: TranslationFileGenerationService;
  batchTasks: BatchTaskRuntime;
  batchRequests: BatchRequestService;
  batchTranslation: BatchTranslationService;
  agent?: Agent;
  unsubscribe: () => void;
};

/**
 * GUI 与 CLI 共用此组合根装配业务服务及其状态拥有者。
 */
export class BackendServices<Agent extends ProjectAgentLifecycle = ProjectAgentLifecycle> {
  public readonly modelAuth: ChatGPTAuthService; // GUI、CLI 和 Agent 共用账户生命周期。
  public readonly modelCatalog: PiModelCatalog; // GUI 与 CLI 共用的模型能力事实。
  private catalog_check: Promise<void> | null = null; // 唯一启动守卫，关闭时等待已取消的检查收束。
  private readonly publish_event: BackendServicesOptions["publishEvent"]; // 目录应用完成后才通知消费方。
  private readonly game_prepare_worker: GamePrepareWorker;
  private readonly compute_worker_client: ComputeWorkerClient;
  private readonly request_rate_pool = new RequestRatePool();
  private readonly game_directory_operations: GameDirectoryOperations;
  private readonly work_unit_worker_pool: TranslationWorkerPool;
  private readonly planning_worker_pool: PlanningWorkerPool;
  private readonly llm_client: LLMClient;
  private runtime_revision = 0;

  public readonly projects = new ProjectRegistry<OpenProject<Agent>>();
  public readonly globalGate = new GlobalOperationGate(
    () => [...this.projects.values()].every((project) => !project.gate.busy),
    () => [...this.projects.values()].every((project) => !project.gate.get_snapshot().agent),
    () => this.publish_runtime(),
  );
  public readonly app: BackendAppServices;
  public readonly runtime: BackendRuntimeServices;
  public readonly lifecycle: ProjectLifecycleService;
  public readonly translationTransfer: ProjectTranslationTransferService;
  public readonly gameFont: GameFontService;
  public readonly model: ModelService;
  public readonly logManager: LogManager;
  public openAgent?: (project: OpenProject<Agent>) => Promise<Agent>;

  public constructor(private readonly options: BackendServicesOptions) {
    if (options.workspaceRuntimeDirectory) {
      configure_javascript_parser(options.workspaceRuntimeDirectory);
      configure_rgss_parser(options.workspaceRuntimeDirectory);
      configure_python_parser(options.workspaceRuntimeDirectory);
    }
    this.publish_event = options.publishEvent;
    const { paths, metadata, database, appSettingService, workerExecution } = options;
    this.logManager = options.logManager;
    this.game_directory_operations = new GameDirectoryOperations(undefined, this.logManager);
    this.modelCatalog = new PiModelCatalog(paths, this.logManager);
    this.modelAuth = new ChatGPTAuthService(paths, this.globalGate, options.publishEvent);
    this.llm_client = new LLMClient({
      userAgent: metadata.build_linguagacha_user_agent(),
      catalog: this.modelCatalog,
      auth: this.modelAuth,
    });
    this.game_prepare_worker = new GamePrepareWorker(
      workerExecution.kind === "in_process" ? null : workerExecution.gamePrepareWorkerEntryUrl,
      undefined,
      this.logManager,
      options.workspaceRuntimeDirectory,
    );
    this.compute_worker_client = new ComputeWorkerClient({ execution: workerExecution });
    this.work_unit_worker_pool = new TranslationWorkerPool({
      builtinRoot: paths.get_builtin_root(),
      execution: workerExecution,
    });
    this.planning_worker_pool = new PlanningWorkerPool({ execution: workerExecution });
    this.lifecycle = new ProjectLifecycleService(
      this.game_directory_operations,
      database,
      appSettingService,
      paths,
      this.logManager,
      undefined,
      this.game_prepare_worker.run,
    );
    this.translationTransfer = new ProjectTranslationTransferService(
      database,
      this.globalGate,
      () => [...this.projects.values()].map((project) => project.path),
    );
    this.gameFont = new GameFontService(
      this.game_directory_operations,
      this.game_prepare_worker.run,
    );
    this.model = new ModelService(
      paths,
      appSettingService,
      this.llm_client,
      this.globalGate,
      this.modelCatalog,
      this.logManager,
      this.modelAuth,
    );
    const settings = new AppSettingsCommandService(appSettingService, this.globalGate, () =>
      this.projects.values(),
    );
    this.app = {
      paths,
      metadata,
      settings: appSettingService,
      updateSettings: (body) => settings.update(body),
    };
    this.runtime = { getSnapshot: () => ({ runtime: this.read_runtime() }) };
  }

  /** 复用同一磁盘工程，只有首次打开才迁移并安装运行态。 */
  public async open_project(body: JsonRecord): Promise<JsonRecord> {
    return this.globalGate.run_lifecycle(async () => {
      if (typeof body.path !== "string" || body.path.trim() === "")
        throw new AppError("request.validation_failed", { public_details: { field: "path" } });
      if (!default_native_fs.exists(body.path))
        throw new AppError("project.not_found", {
          public_details: { filename: path.basename(body.path) },
        });
      const project_path = default_native_fs.real_path(body.path);
      const opened = this.projects.find(project_path);
      if (opened !== undefined) {
        if (opened.cache.snapshot().freshness === "recoverable_error") await opened.cache.refresh();
        return this.project_snapshot(opened);
      }
      const { snapshot, alignment } = await this.lifecycle.load_project(
        project_path,
        body.confirmed_target_app_version,
      );
      const project = await this.install_project(project_path, snapshot);
      return {
        ...this.project_snapshot(project),
        ...(alignment === null ? {} : { settings_alignment: alignment as unknown as JsonValue }),
      };
    });
  }

  /** 创建提交和运行态安装共用同一生命周期闸。 */
  public async create_project(
    body: JsonRecord,
    on_game_sources_detected?: () => void,
  ): Promise<JsonRecord> {
    return this.globalGate.run_lifecycle(async (signal) => {
      const created = await this.lifecycle.create_project_commit(
        body,
        signal,
        on_game_sources_detected,
      );
      const project = await this.install_project(
        default_native_fs.real_path(created.path),
        created.snapshot,
      );
      return { ...this.project_snapshot(project), source_operation: created.source_operation };
    });
  }

  public list_projects(): JsonRecord {
    return {
      projects: [...this.projects.values()].map((project) => this.project_snapshot(project)),
    };
  }

  public project_snapshot(project: OpenProject<Agent>): JsonRecord {
    const quality = project.cache.quality.readBlock();
    return {
      project: {
        projectId: project.id,
        path: project.path,
        loaded: true,
        name: path.basename(project.path),
        file_count: project.cache.files.size(),
        quality_rule_counts: {
          glossary: quality.glossary.entries.length,
          text_preserve: quality.text_preserve.entries.length,
          pre_replacement: quality.pre_replacement.entries.length,
          post_replacement: quality.post_replacement.entries.length,
        },
        languages: project.cache.languages.readBlock(),
      },
    };
  }

  /** 重连按权威修订恢复页面查询，及早带回工程和对话身份。 */
  public async read_manifest(project: OpenProject<Agent>): Promise<JsonRecord> {
    return this.options.database.read(project.path, (reader) => {
      const manifest = new ProjectDataReader(reader).build_manifest({
        loaded: true,
        projectPath: project.path,
      });
      return { ...manifest, ...this.project_snapshot(project), projectId: project.id };
    });
  }

  public apply_task_input(project: OpenProject<Agent>, input: ProjectTaskInput) {
    return project.gate.run_project_write(async () => {
      const revisions = build_section_revisions_from_meta(
        await this.options.database.get_all_meta(project.path),
      );
      return project.writes.apply_task_input({
        projectPath: project.path,
        expectedSectionRevisions: {
          quality: revisions.quality ?? 0,
          prompts: revisions.prompts ?? 0,
        },
        input,
      });
    });
  }

  /** 普通关闭只接纳空闲工程，应用退出走统一取消流程。 */
  public async close_project(id: unknown): Promise<JsonRecord> {
    return this.globalGate.run_lifecycle(async () => {
      const project = this.projects.require(id);
      if (project.gate.busy) throw new AppError("runtime.busy");
      await this.dispose_project(project);
      return this.list_projects();
    });
  }

  /** 先完成工程持有的服务装配，再对外登记新的打开周期。 */
  private async install_project(
    project_path: string,
    snapshot: ProjectDataSnapshot,
  ): Promise<OpenProject<Agent>> {
    const id = randomUUID();
    const { database, paths, appSettingService: settings, openOutputFolder } = this.options;
    const gate = new ProjectOperationGate((owner) => this.globalGate.check_project(owner));
    const dispose_activity = gate.subscribe(() => this.publish_runtime());
    const cache = new ProjectCache({
      projectPath: project_path,
      projectId: id,
      snapshot,
      database,
      logManager: this.logManager,
      workerClient: this.compute_worker_client,
    });
    const writes = new ProjectWriteStore(
      database,
      (event) => cache.applyCommittedChange(event),
      (change) => {
        const event = adapt_project_change(id, change);
        this.publish_event(PROJECT_CHANGE_EVENT_TOPIC, event as unknown as JsonRecord);
        return event;
      },
      cache,
    );
    const tasks = new BatchTaskRuntime(project_path, gate);
    const translation_runtime = new BatchTranslationState(project_path, database, tasks);
    const runner = new BatchTranslationRunner({
      ratePool: this.request_rate_pool,
      auth: this.modelAuth,
      llmClient: this.llm_client,
      builtinRoot: paths.get_builtin_root(),
      taskStore: new BatchTranslationProjectStore(project_path, cache, writes),
      taskRuntime: translation_runtime,
      executorClient: this.work_unit_worker_pool,
      taskPlanner: new TranslationPlanner({ planningWorkerPool: this.planning_worker_pool }),
      logManager: this.logManager,
    });
    const batchTranslation = new BatchTranslationService(
      runner,
      translation_runtime,
      settings,
      cache.languages,
      this.logManager,
    );
    const project: OpenProject<Agent> = {
      id,
      path: project_path,
      gate,
      cache,
      writes,
      knowledge: new ProjectKnowledgeService(database, project_path, writes, gate, settings),
      summary: new ProjectSummaryService(project_path, cache),
      content: new ProjectContentService(
        this.game_directory_operations,
        database,
        gate,
        project_path,
        writes,
        settings,
        undefined,
        this.logManager,
        this.game_prepare_worker.run,
      ),
      proofreading: {
        query: new ProofreadingQueryService({
          projectPath: project_path,
          cache: cache.proofreading,
        }),
        commands: new ProofreadingService(gate, project_path, writes),
      },
      quality: {
        rules: new QualityRuleService(paths, settings, project_path, writes, gate, cache),
        prompts: new QualityPromptService(
          paths,
          settings,
          database,
          project_path,
          writes,
          gate,
          cache,
        ),
        statistics: new QualityStatisticsService({ cache: cache.qualityStatistics }),
      },
      generation: new TranslationFileGenerationService(
        gate,
        writes,
        this.game_directory_operations,
        database,
        settings,
        project_path,
        openOutputFolder,
        this.logManager,
      ),
      batchTasks: tasks,
      batchRequests: new BatchRequestService(
        tasks,
        this.request_rate_pool,
        this.llm_client,
        this.modelAuth,
        this.logManager,
      ),
      batchTranslation,
      unsubscribe: () => {
        dispose_activity();
        dispose_task();
      },
    };
    const dispose_task = tasks.subscribe(async (task) => {
      this.publish_event(BATCH_TASK_SNAPSHOT_EVENT_TOPIC, {
        projectId: id,
        batch_task: task as unknown as JsonRecord,
        ...(task.kind === "request"
          ? {}
          : {
              batch_translation: (await batchTranslation.snapshot()) as unknown as JsonRecord,
            }),
      });
    });
    try {
      if (this.openAgent !== undefined) project.agent = await this.openAgent(project);
    } catch (cause) {
      project.unsubscribe();
      await tasks.dispose();
      throw new AppError("data.committed_sync_failed", {
        cause,
        public_details: { committed: true, action: "reload_project" },
      });
    }
    this.projects.add(project);
    this.publish_runtime();
    return project;
  }

  private read_runtime(): RuntimeActivitySnapshot {
    const projects = Object.fromEntries(
      [...this.projects.values()].map((project) => [project.id, project.gate.get_snapshot()]),
    );
    const modelTest = this.globalGate.modelTest;
    const states = Object.values(projects);
    const owner = states.some((state) => state.batchTranslation)
      ? "batch_translation"
      : states.some((state) => state.agent)
        ? "agent"
        : modelTest
          ? "model_test"
          : states.some((state) => state.projectWrite)
            ? "project_write"
            : null;
    return { revision: this.runtime_revision, owner, global: { modelTest }, projects };
  }

  private publish_runtime(): void {
    this.runtime_revision++;
    this.publish_event(RUNTIME_ACTIVITY_EVENT_TOPIC, { runtime: this.read_runtime() });
  }

  /** 先封住写入，再收尾任务并释放连接和路由身份。 */
  private async dispose_project(project: OpenProject<Agent>): Promise<void> {
    await project.gate.stop_project_writes();
    const results = await Promise.allSettled([
      project.agent?.dispose(),
      project.batchTasks.dispose(),
    ]);
    project.unsubscribe();
    try {
      await this.options.database.close_project(project.path);
    } finally {
      this.projects.remove(project);
      this.publish_runtime();
    }
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "Project cleanup failed.");
  }

  public async close_projects(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.projects.values()].map((project) => this.dispose_project(project)),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "Open project cleanup failed.");
  }

  /** GUI 启动后检查一次。CLI 使用已加载缓存。 */
  public start_model_catalog_check(): void {
    if (this.catalog_check !== null) return;
    this.catalog_check = this.modelCatalog.check((models, commit, signal) =>
      this.model.apply_catalog(models, commit, signal, () =>
        this.publish_event(MODEL_CATALOG_UPDATED_EVENT_TOPIC, this.modelCatalog.get_snapshot()),
      ),
    );
  }

  /** Gateway 排空请求前，取消并等待工程写入与游戏目录操作收尾。 */
  public async stop_file_operations(): Promise<void> {
    await Promise.all([
      this.globalGate.stop(),
      this.game_directory_operations.stop(),
      ...[...this.projects.values()].map((project) => project.gate.stop_project_writes()),
    ]);
  }

  /**
   * 组合根释放运行态资源。Bootstrap 关闭数据库和日志。
   */
  public async dispose(): Promise<void> {
    const errors: unknown[] = [];
    const file_operations = this.stop_file_operations();
    this.modelCatalog.dispose();
    try {
      await this.catalog_check;
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.close_projects();
    } catch (error) {
      errors.push(error);
    }
    try {
      await file_operations; // 目录恢复和业务收尾完成后才能释放准备线程。
    } catch (error) {
      errors.push(error);
    }
    const worker_results = await Promise.allSettled([
      this.model.dispose(),
      this.work_unit_worker_pool.dispose(),
      this.planning_worker_pool.dispose(),
      this.compute_worker_client.dispose(),
      this.game_prepare_worker.dispose(),
    ]);
    for (const result of worker_results) {
      if (result.status === "rejected") {
        errors.push(result.reason);
      }
    }
    try {
      await this.modelAuth.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close BackendServices resources.");
    }
  }
}
