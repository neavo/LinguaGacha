import type { ApiJsonValue } from "../../api/api-types";
import type { CacheReadPort } from "../../cache/cache-types";
import { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import { ProjectMutationStore } from "../../project/project-mutation-store";
import { ProjectSessionState } from "../../project/project-session";
import { TaskRunState } from "../run/task-run-state";
import type { JsonRecord, MutableJsonRecord } from "../run/task-run-types";
import type { TaskArtifact } from "../protocol/artifact";
import type { TaskType } from "../../../domain/task";
import { QualityRuleSnapshotTool } from "../../../shared/quality/snapshot";
import { TASK_PROGRESS_STATUSES } from "../../../domain/task";
import * as AppErrors from "../../../shared/error";

/**
 * 项目任务存储端口，是 TaskEngine 读写项目任务事实的唯一内部入口
 */
export class ProjectTaskStore {
  private readonly database: ProjectDatabase; // 任务写库也必须经由 ProjectDatabase workflow

  private readonly session_state: ProjectSessionState; // 当前 loaded 工程是任务读写唯一目标

  private readonly task_run_state: TaskRunState; // 重翻任务提交后需要同步缩减运行中 item scope

  private readonly cache: CacheReadPort; // 任务启动热读 items / quality / prompts，写库仍只走 ProjectDatabase

  private readonly mutation_store: ProjectMutationStore; // 任务提交只表达 artifact 语义，事务与事件由 mutation store 统一完成

  /**
   * ProjectTaskStore 只组合现有 TS 权威，不自行持有长期项目缓存
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    task_run_state: TaskRunState,
    cache: CacheReadPort,
    mutation_store: ProjectMutationStore,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.task_run_state = task_run_state;
    this.cache = cache;
    this.mutation_store = mutation_store;
  }

  /**
   * 任务启动前读取当前工程上下文，不依赖旧会话缓存
   */
  public get_project_context(_request: JsonRecord): MutableJsonRecord {
    const state = this.session_state.snapshot();
    return {
      loaded: state.loaded,
      project_path: state.projectPath,
      meta: state.loaded ? this.get_all_meta(state.projectPath) : {},
    };
  }

  /**
   * 后台任务长流程显式保留当前工程连接，结束后释放让 .lg 回到单文件稳定态
   */
  public acquire_project_lease(owner: string): () => void {
    return this.database.acquire_project_lease(this.require_loaded_project_path(), owner);
  }

  /**
   * 任务启动时从 `.lg` 读取质量规则和提示词快照，renderer 缓存不再作为后端任务输入
   */
  public build_quality_snapshot(): ApiJsonValue {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      return QualityRuleSnapshotTool.to_json(QualityRuleSnapshotTool.from_json({}));
    }
    return QualityRuleSnapshotTool.to_json(
      QualityRuleSnapshotTool.from_json({
        quality: this.cache.quality.readBlock(),
        prompts: this.cache.prompts.readBlock(),
      }),
    ) as unknown as ApiJsonValue;
  }

  /**
   * 翻译任务读取条目快照；RESET 只在任务内归零，不把重置写回数据库
   */
  public get_translation_items(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const mode = String(request["mode"] ?? "NEW");
    const items = this.cache.items.readItems().map((item) => {
      if (mode !== "RESET") {
        return item;
      }
      return {
        ...item,
        dst: "",
        status: "NONE",
        retry_count: 0,
      };
    });
    return {
      items: items as unknown as ApiJsonValue,
      meta: this.get_all_meta(project_path),
    };
  }

  /**
   * artifact 是项目任务事实唯一写入口的公开提交协议，调用方不再接触数据库 operation 形状
   */
  public async commit_artifacts(request: JsonRecord): Promise<MutableJsonRecord> {
    const task_type = String(request["task_type"] ?? "translation") as TaskType;
    const artifacts = this.normalize_artifacts(request["artifacts"]);
    const progress_snapshot = this.normalize_nullable_progress_snapshot(
      request["progress_snapshot"],
    );
    if (task_type === "analysis") {
      return await this.commit_analysis_artifacts(artifacts, progress_snapshot);
    }
    return await this.commit_translation_artifacts(artifacts, progress_snapshot);
  }

  /**
   * item_updates artifact 按 affects_proofreading 决定是否推进 proofreading revision
   */
  private async commit_translation_artifacts(
    artifacts: TaskArtifact[],
    progress_snapshot: MutableJsonRecord | null,
  ): Promise<MutableJsonRecord> {
    const item_updates = artifacts.find((artifact) => artifact.kind === "item_updates");
    if (item_updates === undefined) {
      if (progress_snapshot !== null) {
        return this.update_translation_progress({
          translation_extras: progress_snapshot as unknown as ApiJsonValue,
        });
      }
      return { accepted: true };
    }
    const request = {
      items: item_updates.items,
      translation_extras: (progress_snapshot ?? {}) as unknown as ApiJsonValue,
    };
    return item_updates.affects_proofreading
      ? await this.commit_item_updates_with_proofreading(request)
      : await this.commit_item_updates_batch(request);
  }

  /**
   * analysis artifact 拆成 checkpoint、候选和进度，具体 SQL 仍只在 ProjectTaskStore 内部
   */
  private async commit_analysis_artifacts(
    artifacts: TaskArtifact[],
    progress_snapshot: MutableJsonRecord | null,
  ): Promise<MutableJsonRecord> {
    const checkpoints = artifacts.filter((artifact) => artifact.kind === "analysis_checkpoints");
    const candidates = artifacts.filter((artifact) => artifact.kind === "analysis_candidates");
    return await this.commit_analysis_artifact_batch({
      success_checkpoints: checkpoints.flatMap((artifact) =>
        this.normalize_checkpoint_rows(artifact.checkpoints),
      ) as unknown as ApiJsonValue,
      error_checkpoints: [] as unknown as ApiJsonValue,
      glossary_entries: candidates.flatMap((artifact) =>
        this.normalize_glossary_entries(artifact.entries),
      ) as unknown as ApiJsonValue,
      progress_snapshot: (progress_snapshot ?? {}) as unknown as ApiJsonValue,
    });
  }

  /**
   * 翻译批次提交同事务写入 items 和 translation_extras，再发布后端权威行级 delta
   */
  private async commit_item_updates_batch(request: JsonRecord): Promise<MutableJsonRecord> {
    const project_path = this.require_loaded_project_path();
    const extras = this.normalize_object(request["translation_extras"]);
    const ack = await this.mutation_store.apply_translation_item_patches({
      projectPath: project_path,
      items: request["items"],
      translationExtras: extras,
    });
    return {
      changed_item_ids: ack.changed_item_ids as unknown as ApiJsonValue,
      section_revisions: ack.section_revisions,
    };
  }

  /**
   * 翻译收尾只持久化进度 extras，避免无变更批次仍触发 item patch
   */
  public update_translation_progress(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const extras = this.normalize_object(request["translation_extras"]);
    this.mutation_store.update_task_progress_meta({
      projectPath: project_path,
      meta: { translation_extras: extras as unknown as ApiJsonValue },
    });
    return { accepted: true };
  }

  /**
   * 分析任务一次性读取 items、checkpoint 和 meta，供 Task Engine 构建计划
   */
  public get_analysis_context(_request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    return {
      items: this.cache.items.readItems() as unknown as ApiJsonValue,
      checkpoints: this.get_analysis_checkpoints(project_path) as unknown as ApiJsonValue,
      meta: this.get_all_meta(project_path),
    };
  }

  /**
   * NEW/RESET 分析任务清空分析派生事实，保持 ProjectTaskStore 为数据写入口
   */
  public async reset_analysis_progress(_request: JsonRecord): Promise<MutableJsonRecord> {
    const project_path = this.require_loaded_project_path();
    await this.mutation_store.reset_analysis_state({
      projectPath: project_path,
      requireExpectedSectionRevisions: false,
      source: "analysis_reset",
      mode: "all",
      analysisExtras: {},
      analysisCandidateCount: 0,
      sectionData: this.build_analysis_section_delta({}, 0),
    });
    return { accepted: true };
  }

  /**
   * 分析进度快照只写 meta；需要时会附带当前候选数量回给 Task Engine
   */
  public update_analysis_progress(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const snapshot = this.normalize_progress_snapshot(
      this.normalize_object(request["analysis_extras"]),
    );
    this.mutation_store.update_task_progress_meta({
      projectPath: project_path,
      meta: { analysis_extras: snapshot as unknown as ApiJsonValue },
    });
    const meta = this.get_all_meta(project_path);
    return {
      analysis_extras: snapshot,
      analysis_candidate_count: this.read_number(meta["analysis_candidate_count"], 0),
    };
  }

  /**
   * 分析批次提交 checkpoint、候选池与进度，确保分析写入口仍在 ProjectTaskStore
   */
  private async commit_analysis_artifact_batch(request: JsonRecord): Promise<MutableJsonRecord> {
    const project_path = this.require_loaded_project_path();
    return await this.mutation_store.commit_analysis_artifacts({
      projectPath: project_path,
      successCheckpoints: request["success_checkpoints"],
      errorCheckpoints: request["error_checkpoints"],
      glossaryEntries: request["glossary_entries"],
      progressSnapshot: request["progress_snapshot"],
    });
  }

  /**
   * 重翻任务读取指定条目，进入 work unit 前重置为待翻译态
   */
  public get_translation_items_by_scope(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const item_ids = this.normalize_number_list(request["item_ids"]);
    const items = item_ids
      .map((item_id) => this.cache.items.readItem(item_id))
      .filter((item): item is MutableJsonRecord => item !== null)
      .map((item) => ({
        ...item,
        status: "NONE",
        retry_count: 0,
      }));
    return {
      items: items as unknown as ApiJsonValue,
      meta: this.get_all_meta(project_path),
    };
  }

  /**
   * 重翻批次提交同时推进 items 与 proofreading revision，并发布行级项目变更
   */
  private async commit_item_updates_with_proofreading(
    request: JsonRecord,
  ): Promise<MutableJsonRecord> {
    const project_path = this.require_loaded_project_path();
    const translation_extras = this.normalize_object(request["translation_extras"]);
    const ack = await this.mutation_store.apply_retranslation_item_patches({
      projectPath: project_path,
      items: request["items"],
      translationExtras: translation_extras,
    });
    const changed_item_ids = ack.changed_item_ids;
    this.task_run_state.remove_translation_item_ids(changed_item_ids);
    return {
      changed_item_ids: changed_item_ids as unknown as ApiJsonValue,
      translation_scope: this.task_run_state.snapshot()
        .translation_scope as unknown as ApiJsonValue,
      section_revisions: ack.section_revisions,
    };
  }

  /**
   * 当前 loaded 工程是所有任务数据 API 的唯一目标
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * analysis 高频事件只需要进度与候选数量，完整 candidate_aggregate 改由按需接口读取。
   */
  private build_analysis_section_delta(
    analysis_extras: MutableJsonRecord,
    candidate_count: number,
  ): MutableJsonRecord {
    const snapshot = this.normalize_progress_snapshot(analysis_extras);
    return {
      extras: snapshot,
      candidate_count: Math.max(0, Math.trunc(candidate_count)),
      status_summary: {
        total_line: this.read_number(snapshot["total_line"], 0),
        processed_line: this.read_number(snapshot["processed_line"], 0),
        error_line: this.read_number(snapshot["error_line"], 0),
        line: this.read_number(snapshot["line"], 0),
      },
    };
  }

  /**
   * checkpoint 成功行保持任务侧传入的状态，非法状态直接丢弃
   */
  private normalize_checkpoint_rows(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const rows: MutableJsonRecord[] = [];
    for (const raw_row of value) {
      if (!this.is_record(raw_row)) {
        continue;
      }
      const item_id = this.read_number(raw_row["item_id"], 0);
      const status = String(raw_row["status"] ?? "");
      if (item_id <= 0 || !(TASK_PROGRESS_STATUSES as readonly string[]).includes(status)) {
        continue;
      }
      rows.push({
        item_id,
        status,
        updated_at: String(raw_row["updated_at"] ?? new Date().toISOString()),
        error_count: this.read_number(raw_row["error_count"], 0),
      });
    }
    return rows;
  }

  /**
   * 分析提交术语只保留可进入候选池的最小字段
   */
  private normalize_glossary_entries(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const entries: MutableJsonRecord[] = [];
    const seen = new Set<string>();
    for (const raw_entry of value) {
      if (!this.is_record(raw_entry)) {
        continue;
      }
      const src = String(raw_entry["src"] ?? "").trim();
      const dst = String(raw_entry["dst"] ?? "").trim();
      const info = String(raw_entry["info"] ?? "").trim();
      const case_sensitive = Boolean(raw_entry["case_sensitive"] ?? false);
      const key = `${src}\u0000${dst}\u0000${info}\u0000${case_sensitive ? "1" : "0"}`;
      if (src === "" || dst === "" || seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({ src, dst, info, case_sensitive });
    }
    return entries;
  }

  /**
   * 分析提交允许不带进度快照，null 表示只提交 checkpoint / 候选
   */
  private normalize_nullable_progress_snapshot(
    value: ApiJsonValue | undefined,
  ): MutableJsonRecord | null {
    if (!this.is_record(value)) {
      return null;
    }
    return this.normalize_progress_snapshot(value);
  }

  /**
   * 任务进度只接受旧快照固定字段，缺失和坏值统一归零
   */
  private normalize_progress_snapshot(value: JsonRecord): MutableJsonRecord {
    return {
      start_time: this.read_float(value["start_time"], 0),
      time: this.read_float(value["time"], 0),
      total_line: this.read_number(value["total_line"], 0),
      line: this.read_number(value["line"], 0),
      processed_line: this.read_number(value["processed_line"], 0),
      error_line: this.read_number(value["error_line"], 0),
      total_tokens: this.read_number(value["total_tokens"], 0),
      total_input_tokens: this.read_number(value["total_input_tokens"], 0),
      total_output_tokens: this.read_number(value["total_output_tokens"], 0),
    };
  }

  /**
   * 读取全部条目只经 database workflow，避免任务层直接碰 SQL
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * 重翻按 id 批量取项，过滤非对象行保护 work unit 入口
   */
  private get_items_by_ids(project_path: string, item_ids: number[]): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getItemsByIds", {
        projectPath: project_path,
        itemIds: item_ids as unknown as DatabaseJsonValue,
      }),
    );
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * meta 快照统一转成普通对象，避免 undefined 泄漏到内部 JSON
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * checkpoint 读取保持行级普通对象，分析调度再做业务状态判断
   */
  private get_analysis_checkpoints(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getAnalysisItemCheckpoints", { projectPath: project_path }),
    );
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => this.is_record(row)).map((row) => ({ ...row }))
      : [];
  }

  /**
   * work unit 提交的 item payload 必须先收窄为普通对象数组
   */
  private normalize_items(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * artifact 在 JSON 边界只接受已知 kind，坏载荷直接丢弃避免写错项目事实
   */
  private normalize_artifacts(value: ApiJsonValue | undefined): TaskArtifact[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const artifacts: TaskArtifact[] = [];
    for (const raw_artifact of value) {
      if (!this.is_record(raw_artifact)) {
        continue;
      }
      if (raw_artifact["kind"] === "item_updates") {
        artifacts.push({
          kind: "item_updates",
          source: "translation",
          items: this.normalize_items(raw_artifact["items"]) as unknown as ApiJsonValue,
          affects_proofreading: Boolean(raw_artifact["affects_proofreading"]),
        });
      } else if (raw_artifact["kind"] === "analysis_checkpoints") {
        artifacts.push({
          kind: "analysis_checkpoints",
          checkpoints: this.normalize_checkpoint_rows(
            raw_artifact["checkpoints"],
          ) as unknown as ApiJsonValue,
        });
      } else if (raw_artifact["kind"] === "analysis_candidates") {
        artifacts.push({
          kind: "analysis_candidates",
          entries: this.normalize_glossary_entries(
            raw_artifact["entries"],
          ) as unknown as ApiJsonValue,
        });
      }
    }
    return artifacts;
  }

  /**
   * 外部传入 id 列表只保留正整数，避免无效 id 打进数据库查询
   */
  private normalize_number_list(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value
          .map((item) => this.read_number(item, NaN))
          .filter((item_id) => Number.isFinite(item_id) && item_id > 0),
      ),
    ];
  }

  /**
   * JSON 普通对象归一集中处理，数组不能被当作 record
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 整数读取用于行号、token 和计数字段，坏值回退到调用方默认值
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 浮点读取用于耗时字段，避免任务时间被错误截断
   */
  private read_float(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }

  /**
   * 类型守卫集中收窄 JSON record，减少调用点重复判断
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * database operation 统一构造，保证任务层不散落操作对象形状
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
