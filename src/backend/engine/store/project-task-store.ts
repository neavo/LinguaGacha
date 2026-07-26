import type { ApiJsonValue } from "../../api/api-types";
import type { CacheReadPort } from "../../cache/cache-types";
import { ProjectDatabase } from "../../database/database-operations";
import { ProjectWriteStore } from "../../project/project-write-store";
import { ProjectSessionState } from "../../project/project-session";
import { TaskRunState } from "../run/task-run-state";
import type { JsonRecord, MutableJsonRecord } from "../run/task-run-types";
import { QualityRuleSnapshotTool } from "../../../shared/quality/snapshot";
import { TASK_PROGRESS_STATUSES } from "../../../domain/task";
import { is_json_record, read_json_record } from "../../../domain/json";

/**
 * 项目任务存储端口，是 TaskEngine 读写项目任务事实的唯一内部入口
 */
export class ProjectTaskStore {
  private readonly database: ProjectDatabase; // 任务写库也必须经由 ProjectDatabase workflow

  private readonly session_state: ProjectSessionState; // 当前 loaded 工程是任务读写唯一目标

  private readonly task_run_state: TaskRunState; // 重翻任务提交后需要同步缩减运行中 item scope

  private readonly cache: CacheReadPort; // 任务启动热读 items / quality / prompts，写库仍只走 ProjectDatabase

  private readonly write_store: ProjectWriteStore; // 事务与项目变更事件由 ProjectWriteStore 统一完成

  /**
   * ProjectTaskStore 只组合现有 TS 权威，不自行持有长期项目缓存
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    task_run_state: TaskRunState,
    cache: CacheReadPort,
    write_store: ProjectWriteStore,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.task_run_state = task_run_state;
    this.cache = cache;
    this.write_store = write_store;
  }

  /**
   * 后台任务长流程显式保留当前工程连接，结束后释放让 .lg 回到单文件稳定态
   */
  public acquire_project_lease(owner: string): () => void {
    return this.database.acquire_project_lease(
      this.session_state.require_loaded_project_path(),
      owner,
    );
  }

  /**
   * 任务启动时从 `.lg` 读取质量规则和提示词快照，渲染进程缓存不再作为后端任务输入
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
    const project_path = this.session_state.require_loaded_project_path();
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
   * 翻译批次只接收已收窄的 item 与进度；scope 决定是否同步推进校对事实
   */
  public async commit_translation_items(
    items: MutableJsonRecord[],
    progress_snapshot: MutableJsonRecord,
    affects_proofreading: boolean,
  ): Promise<MutableJsonRecord> {
    const normalized_items = items.map((item) => ({ ...item }));
    const normalized_progress = this.normalize_progress_snapshot(progress_snapshot);
    return affects_proofreading
      ? await this.commit_item_updates_with_proofreading(normalized_items, normalized_progress)
      : await this.commit_item_updates_batch(normalized_items, normalized_progress);
  }

  /**
   * 分析批次在同一写入口提交 checkpoint、候选池和进度快照
   */
  public async commit_analysis_results(
    checkpoints: MutableJsonRecord[],
    glossary_entries: MutableJsonRecord[],
    progress_snapshot: MutableJsonRecord,
  ): Promise<MutableJsonRecord> {
    const project_path = this.session_state.require_loaded_project_path();
    return await this.write_store.commit_analysis_artifacts({
      projectPath: project_path,
      successCheckpoints: this.normalize_checkpoint_rows(
        checkpoints as unknown as ApiJsonValue,
      ) as unknown as ApiJsonValue,
      errorCheckpoints: [],
      glossaryEntries: this.normalize_glossary_entries(
        glossary_entries as unknown as ApiJsonValue,
      ) as unknown as ApiJsonValue,
      progressSnapshot: this.normalize_progress_snapshot(progress_snapshot),
    });
  }

  /**
   * 翻译批次提交同事务写入 items 和 translation_extras，再发布后端权威行级增量
   */
  private async commit_item_updates_batch(
    items: MutableJsonRecord[],
    translation_extras: MutableJsonRecord,
  ): Promise<MutableJsonRecord> {
    const project_path = this.session_state.require_loaded_project_path();
    const ack = await this.write_store.apply_translation_item_patches({
      projectPath: project_path,
      items: items as unknown as ApiJsonValue,
      translationExtras: translation_extras,
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
    const project_path = this.session_state.require_loaded_project_path();
    const extras = { ...read_json_record(request["translation_extras"]) };
    this.write_store.update_task_progress_meta({
      projectPath: project_path,
      meta: { translation_extras: extras as unknown as ApiJsonValue },
    });
    return { accepted: true };
  }

  /**
   * 分析任务一次性读取 items、checkpoint 和 meta，供 Task Engine 构建计划
   */
  public get_analysis_context(_request: JsonRecord): MutableJsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
    return {
      items: this.cache.items.readItems() as unknown as ApiJsonValue,
      checkpoints: this.get_analysis_checkpoints(project_path) as unknown as ApiJsonValue,
      meta: this.get_all_meta(project_path),
    };
  }

  /**
   * NEW/RESET 分析任务清空分析计算事实，保持 ProjectTaskStore 为数据写入口
   */
  public async reset_analysis_progress(_request: JsonRecord): Promise<MutableJsonRecord> {
    const project_path = this.session_state.require_loaded_project_path();
    await this.write_store.reset_analysis_state({
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
    const project_path = this.session_state.require_loaded_project_path();
    const snapshot = this.normalize_progress_snapshot({
      ...read_json_record(request["analysis_extras"]),
    });
    this.write_store.update_task_progress_meta({
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
   * 重翻任务读取指定条目，进入 work unit 前重置为待翻译态
   */
  public get_translation_items_by_scope(request: JsonRecord): MutableJsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
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
    items: MutableJsonRecord[],
    translation_extras: MutableJsonRecord,
  ): Promise<MutableJsonRecord> {
    const project_path = this.session_state.require_loaded_project_path();
    const ack = await this.write_store.apply_retranslation_item_patches({
      projectPath: project_path,
      items: items as unknown as ApiJsonValue,
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
      if (!is_json_record(raw_row)) {
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
      if (!is_json_record(raw_entry)) {
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
   * meta 快照统一转成普通对象，避免 undefined 泄漏到内部 JSON
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return { ...read_json_record(this.database.get_all_meta(project_path)) };
  }

  /**
   * checkpoint 读取保持行级普通对象，分析调度再做业务状态判断
   */
  private get_analysis_checkpoints(project_path: string): MutableJsonRecord[] {
    const value = this.database.get_analysis_item_checkpoints(project_path);
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => is_json_record(row)).map((row) => ({ ...row }))
      : [];
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
}
