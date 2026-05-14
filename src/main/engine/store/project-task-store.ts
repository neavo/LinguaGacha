import type { ApiJsonValue } from "../../api/api-types";
import { app_error } from "../../api/app-error";
import { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import { ProjectChangePublisher } from "../../project/project-change-publisher";
import { ProjectRuntimeProjectionService } from "../../project/project-runtime-projection-service";
import { get_runtime_section_revision } from "../../project/project-section-revision";
import { ProjectSessionState } from "../../project/project-session-state";
import { TaskRuntimeState } from "../runtime/task-runtime-state";
import type { JsonRecord, MutableJsonRecord } from "../runtime/task-runtime-types";
import type { TaskArtifact } from "../protocol/artifact";
import type { TaskType } from "../protocol/task-types";
import { QualityRuleSnapshotTool } from "../../../shared/quality/snapshot";
import { TASK_PROGRESS_STATUSES } from "../../../shared/task";

/**
 * 项目任务存储端口，是 TaskEngine 读写项目任务事实的唯一内部入口
 */
export class ProjectTaskStore {
  /**
   * ProjectTaskStore 只组合现有 TS 权威，不自行持有长期项目缓存
   */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly session_state: ProjectSessionState,
    private readonly task_runtime_state: TaskRuntimeState,
    private readonly project_change_publisher: ProjectChangePublisher,
  ) {}

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
    const projection_service = new ProjectRuntimeProjectionService(this.database);
    const payload = projection_service.build_section_payloads({
      projectState: state,
      sections: ["quality", "prompts"],
    });
    const sections = this.normalize_object(payload["sections"]);
    return QualityRuleSnapshotTool.to_json(
      QualityRuleSnapshotTool.from_json({
        quality: sections["quality"],
        prompts: sections["prompts"],
      }),
    ) as unknown as ApiJsonValue;
  }

  /**
   * 翻译任务读取条目快照；RESET 只在任务内归零，不把重置写回数据库
   */
  public get_translation_items(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const mode = String(request["mode"] ?? "NEW");
    const items = this.get_all_items(project_path).map((item) => {
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
  public commit_artifacts(request: JsonRecord): MutableJsonRecord {
    const task_type = String(request["task_type"] ?? "translation") as TaskType;
    const artifacts = this.normalize_artifacts(request["artifacts"]);
    const progress_snapshot = this.normalize_nullable_progress_snapshot(
      request["progress_snapshot"],
    );
    if (task_type === "analysis") {
      return this.commit_analysis_artifacts(artifacts, progress_snapshot);
    }
    return this.commit_translation_artifacts(artifacts, progress_snapshot);
  }

  /**
   * item_updates artifact 按 affects_proofreading 决定是否推进 proofreading revision
   */
  private commit_translation_artifacts(
    artifacts: TaskArtifact[],
    progress_snapshot: MutableJsonRecord | null,
  ): MutableJsonRecord {
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
      ? this.commit_item_updates_with_proofreading(request)
      : this.commit_item_updates_batch(request);
  }

  /**
   * analysis artifact 拆成 checkpoint、候选和进度，具体 SQL 仍只在 ProjectTaskStore 内部
   */
  private commit_analysis_artifacts(
    artifacts: TaskArtifact[],
    progress_snapshot: MutableJsonRecord | null,
  ): MutableJsonRecord {
    const checkpoints = artifacts.filter((artifact) => artifact.kind === "analysis_checkpoints");
    const candidates = artifacts.filter((artifact) => artifact.kind === "analysis_candidates");
    return this.commit_analysis_artifact_batch({
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
   * 翻译批次提交同事务写入 items 和 translation_extras，再发最小运行态 patch
   */
  private commit_item_updates_batch(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const finalized_items = this.normalize_items(request["items"]);
    const extras = this.normalize_object(request["translation_extras"]);
    this.database.execute_transaction([
      this.op("updateBatch", {
        projectPath: project_path,
        items: finalized_items as unknown as DatabaseJsonValue,
        meta: { translation_extras: extras } as unknown as DatabaseJsonValue,
      }),
      ...this.bump_runtime_revision_operations(project_path, ["items"]),
    ]);
    const changed_item_ids = this.collect_item_ids(finalized_items);
    if (changed_item_ids.length > 0) {
      this.project_change_publisher.publish_project_change({
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: {
          payloadMode: "canonical-delta",
          changedIds: changed_item_ids as unknown as ApiJsonValue,
        },
      });
    }
    return {
      changed_item_ids: changed_item_ids as unknown as ApiJsonValue,
      section_revisions: this.build_section_revisions(project_path, ["items"]),
    };
  }

  /**
   * 翻译收尾只持久化进度 extras，避免无变更批次仍触发 item patch
   */
  public update_translation_progress(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const extras = this.normalize_object(request["translation_extras"]);
    this.database.execute(
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: { translation_extras: extras } as unknown as DatabaseJsonValue,
      }),
    );
    return { accepted: true };
  }

  /**
   * 分析任务一次性读取 items、checkpoint 和 meta，供 Task Engine 构建计划
   */
  public get_analysis_context(_request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    return {
      items: this.get_all_items(project_path) as unknown as ApiJsonValue,
      checkpoints: this.get_analysis_checkpoints(project_path) as unknown as ApiJsonValue,
      meta: this.get_all_meta(project_path),
    };
  }

  /**
   * NEW/RESET 分析任务清空分析派生事实，保持 ProjectTaskStore 为数据写入口
   */
  public reset_analysis_progress(_request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    this.database.execute_transaction([
      this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
      this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: { analysis_extras: {}, analysis_candidate_count: 0 },
      }),
      ...this.bump_runtime_revision_operations(project_path, ["analysis"]),
    ]);
    this.publish_analysis_patch("analysis_reset");
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
    this.database.execute(
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: { analysis_extras: snapshot },
      }),
    );
    const meta = this.get_all_meta(project_path);
    return {
      analysis_extras: snapshot,
      analysis_candidate_count: this.read_number(meta["analysis_candidate_count"], 0),
    };
  }

  /**
   * 分析批次提交 checkpoint、候选池与进度，确保分析写入口仍在 ProjectTaskStore
   */
  private commit_analysis_artifact_batch(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const success_checkpoints = this.normalize_checkpoint_rows(request["success_checkpoints"]);
    const error_checkpoints = this.normalize_error_checkpoint_rows(request["error_checkpoints"]);
    const glossary_entries = this.normalize_glossary_entries(request["glossary_entries"]);
    const progress_snapshot = this.normalize_nullable_progress_snapshot(
      request["progress_snapshot"],
    );
    const candidate_result = this.build_next_candidate_rows(project_path, glossary_entries);
    const operations: DatabaseOperation[] = [];
    if (success_checkpoints.length > 0 || error_checkpoints.length > 0) {
      operations.push(
        this.op("upsertAnalysisItemCheckpoints", {
          projectPath: project_path,
          checkpoints: [
            ...success_checkpoints,
            ...error_checkpoints,
          ] as unknown as DatabaseJsonValue,
        }),
      );
    }
    if (candidate_result.rows.length > 0) {
      operations.push(
        this.op("upsertAnalysisCandidateAggregates", {
          projectPath: project_path,
          aggregates: candidate_result.rows as unknown as DatabaseJsonValue,
        }),
      );
    }
    operations.push(
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: {
          ...(progress_snapshot === null ? {} : { analysis_extras: progress_snapshot }),
          analysis_candidate_count: candidate_result.count,
        },
      }),
      ...this.bump_runtime_revision_operations(project_path, ["analysis"]),
    );
    this.database.execute_transaction(operations);
    this.publish_analysis_patch("analysis_batch_update");
    return {
      inserted_count: glossary_entries.length,
      analysis_candidate_count: candidate_result.count,
      section_revisions: this.build_section_revisions(project_path, ["analysis"]),
    };
  }

  /**
   * 重翻任务读取指定条目，进入 work unit 前重置为待翻译态
   */
  public get_translation_items_by_scope(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const item_ids = this.normalize_number_list(request["item_ids"]);
    const items = this.get_items_by_ids(project_path, item_ids).map((item) => ({
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
  private commit_item_updates_with_proofreading(request: JsonRecord): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const finalized_items = this.normalize_items(request["items"]);
    const translation_extras = this.normalize_object(request["translation_extras"]);
    const next_proofreading_revision =
      get_runtime_section_revision(this.get_all_meta(project_path), "proofreading") + 1;
    this.database.execute_transaction([
      this.op("updateBatch", {
        projectPath: project_path,
        items: finalized_items as unknown as DatabaseJsonValue,
        meta: {
          translation_extras,
          "proofreading_revision.proofreading": next_proofreading_revision,
        } as unknown as DatabaseJsonValue,
      }),
      ...this.bump_runtime_revision_operations(project_path, ["items"]),
    ]);
    const changed_item_ids = this.collect_item_ids(finalized_items);
    this.task_runtime_state.remove_translation_item_ids(changed_item_ids);
    this.project_change_publisher.publish_project_change({
      source: "retranslate_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "canonical-delta",
        changedIds: changed_item_ids as unknown as ApiJsonValue,
      },
      sections: {
        proofreading: { payloadMode: "canonical-delta" },
      },
    });
    return {
      changed_item_ids: changed_item_ids as unknown as ApiJsonValue,
      translation_scope: this.task_runtime_state.snapshot()
        .translation_scope as unknown as ApiJsonValue,
      section_revisions: this.build_section_revisions(project_path, ["items", "proofreading"]),
    };
  }

  /**
   * 当前 loaded 工程是所有任务数据 API 的唯一目标
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw app_error("project_not_loaded");
    }
    return state.projectPath;
  }

  /**
   * 发布 analysis 变更时统一交给 ProjectChangeEventAdapter 补全分析块和 revision
   */
  private publish_analysis_patch(source: string): void {
    this.project_change_publisher.publish_project_change({
      source,
      updatedSections: ["analysis"],
      sections: {
        analysis: { payloadMode: "canonical-delta" },
      },
    });
  }

  /**
   * 从当前 meta 构建指定 section revision 响应，供任务提交回执和日志使用
   */
  private build_section_revisions(project_path: string, sections: string[]): MutableJsonRecord {
    const meta = this.get_all_meta(project_path);
    const result: MutableJsonRecord = {};
    for (const section of sections) {
      result[section] = get_runtime_section_revision(meta, section);
    }
    return result;
  }

  /**
   * project_runtime_revision 仍只覆盖由 任务数据写入的运行态 section
   */
  private bump_runtime_revision_operations(
    project_path: string,
    sections: string[],
  ): DatabaseOperation[] {
    const meta = this.get_all_meta(project_path);
    return sections.map((section) =>
      this.op("setMeta", {
        projectPath: project_path,
        key: `project_runtime_revision.${section}`,
        value: get_runtime_section_revision(meta, section) + 1,
      }),
    );
  }

  /**
   * 分析候选池按 src 合并，保留 服务端内部最小投票语义
   */
  private build_next_candidate_rows(
    project_path: string,
    glossary_entries: MutableJsonRecord[],
  ): { rows: MutableJsonRecord[]; count: number } {
    const aggregate = new Map<string, MutableJsonRecord>();
    for (const row of this.get_candidate_aggregate(project_path)) {
      const src = String(row["src"] ?? "").trim();
      if (src !== "") {
        aggregate.set(src, {
          ...row,
          dst_votes: this.normalize_vote_map(row["dst_votes"]),
          info_votes: this.normalize_vote_map(row["info_votes"]),
        });
      }
    }
    const now = new Date().toISOString();
    for (const entry of glossary_entries) {
      const src = String(entry["src"] ?? "").trim();
      const dst = String(entry["dst"] ?? "").trim();
      if (src === "" || dst === "") {
        continue;
      }
      const current =
        aggregate.get(src) ??
        ({
          src,
          dst_votes: {},
          info_votes: {},
          observation_count: 0,
          first_seen_at: now,
          last_seen_at: now,
          case_sensitive: Boolean(entry["case_sensitive"] ?? false),
        } as MutableJsonRecord);
      const dst_votes = this.normalize_vote_map(current["dst_votes"]);
      const info_votes = this.normalize_vote_map(current["info_votes"]);
      const info = String(entry["info"] ?? "").trim();
      dst_votes[dst] = this.read_number(dst_votes[dst], 0) + 1;
      if (info !== "") {
        info_votes[info] = this.read_number(info_votes[info], 0) + 1;
      }
      current["dst_votes"] = dst_votes as unknown as ApiJsonValue;
      current["info_votes"] = info_votes as unknown as ApiJsonValue;
      current["observation_count"] = this.read_number(current["observation_count"], 0) + 1;
      current["last_seen_at"] = now;
      current["case_sensitive"] =
        Boolean(current["case_sensitive"]) || Boolean(entry["case_sensitive"]);
      aggregate.set(src, current);
    }
    const rows = [...aggregate.values()];
    return { rows, count: this.count_candidate_entries(rows) };
  }

  /**
   * 候选数只统计可导出的候选项，和旧 AnalysisCandidateService 口径一致
   */
  private count_candidate_entries(rows: MutableJsonRecord[]): number {
    let count = 0;
    for (const row of rows) {
      const src = String(row["src"] ?? "").trim();
      const dst = this.pick_vote_winner(this.normalize_vote_map(row["dst_votes"]));
      const info = this.pick_vote_winner(this.normalize_vote_map(row["info_votes"]));
      if (src !== "" && dst !== "" && info !== "" && info.toLowerCase() !== "other") {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 同票时保留对象插入顺序，匹配历史字典遍历的稳定性
   */
  private pick_vote_winner(votes: Record<string, number>): string {
    let best_text = "";
    let best_votes = -1;
    for (const [text, count] of Object.entries(votes)) {
      if (count > best_votes) {
        best_text = text;
        best_votes = count;
      }
    }
    return best_text;
  }

  /**
   * 投票 map 只接受正整数票数，坏数据不会进入新候选池
   */
  private normalize_vote_map(value: ApiJsonValue | undefined): Record<string, number> {
    if (!this.is_record(value)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, raw_votes] of Object.entries(value)) {
      const text = String(key).trim();
      const votes = this.read_number(raw_votes, 0);
      if (text !== "" && votes > 0) {
        result[text] = (result[text] ?? 0) + votes;
      }
    }
    return result;
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
   * 失败 checkpoint 在 服务端补齐错误次数，避免 worker 持有旧 checkpoint 缓存
   */
  private normalize_error_checkpoint_rows(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    const project_path = this.require_loaded_project_path();
    const existing = new Map<number, MutableJsonRecord>();
    for (const row of this.get_analysis_checkpoints(project_path)) {
      existing.set(this.read_number(row["item_id"], 0), row);
    }
    const now = new Date().toISOString();
    return this.normalize_checkpoint_rows(value).map((row) => {
      const item_id = this.read_number(row["item_id"], 0);
      const previous = existing.get(item_id);
      const previous_error_count =
        previous?.["status"] === "ERROR" ? this.read_number(previous["error_count"], 0) : 0;
      return {
        ...row,
        status: "ERROR",
        updated_at: now,
        error_count: previous_error_count + 1,
      };
    });
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
   * 候选聚合读取只服务分析提交合并，不暴露给公开 API
   */
  private get_candidate_aggregate(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getAnalysisCandidateAggregates", { projectPath: project_path }),
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
   * patch 只需要变更 item id，去重后可避免重复 merge
   */
  private collect_item_ids(items: MutableJsonRecord[]): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const item of items) {
      const item_id = this.read_number(item["id"], 0);
      if (item_id > 0 && !seen.has(item_id)) {
        seen.add(item_id);
        ids.push(item_id);
      }
    }
    return ids;
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
