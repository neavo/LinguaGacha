import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  infer_item_text_type_from_source,
  normalize_item_file_type,
  normalize_item_status,
} from "../../base/item";
import {
  QUALITY_RULE_TYPES,
  normalize_text_preserve_mode,
  resolve_quality_rule_database_type,
  resolve_quality_rule_enabled_meta_key,
  type QualityRuleType,
} from "../../base/quality";
import {
  PROMPT_TASK_TYPES,
  build_prompt_enabled_meta_key,
  resolve_prompt_database_type,
} from "../../base/prompt";
import { TASK_PROGRESS_STATUSES, is_task_skipped_item_status } from "../../base/task";
import { TaskSnapshotBuilder } from "../task-engine/runtime/task-snapshot-builder";
import {
  build_project_mutation_ack_from_meta,
  build_section_revisions_from_meta,
  get_runtime_section_revision,
  type RuntimeSection,
} from "./project-section-revision";
import { ProjectSessionState } from "./project-session-state";

// JsonRecord 表示从数据库或 meta 读取出的普通 JSON 字典，编码器不会保留对象引用。
type JsonRecord = Record<string, ApiJsonValue>;
// MutableJsonRecord 用于组装 SSE payload，离开编码器后仍按值传递给前端。
type MutableJsonRecord = Record<string, ApiJsonValue>;

// RowBlock 是 files/items 的稳定 wire shape，字段顺序本身就是协议。
type RowBlock = { fields: string[]; rows: ApiJsonValue[][] };

/**
 * Gateway 写 SSE 时只需要事件名和 data，编码器不持有底层 stream。
 */
export interface BootstrapSseEvent {
  event: string;
  data: MutableJsonRecord;
}

/**
 * files 与 items 必须复用同一轮 item 快照，避免首包中 file_type 和 item 行来自不同读点。
 */
interface RuntimeItemsSnapshot {
  item_records: MutableJsonRecord[];
  records_by_path: Map<string, { rel_path: string; file_type: string }>;
}

// stage 顺序是前端 ProjectStore 初始化契约，新增或重排必须同步 API 文档。
const BOOTSTRAP_STAGE_DEFINITIONS: Array<{
  stage: RuntimeSection;
  message: string;
}> = [
  { stage: "project", message: "正在加载项目骨架" },
  { stage: "files", message: "正在加载项目文件" },
  { stage: "items", message: "正在加载项目条目" },
  { stage: "quality", message: "正在加载质量规则" },
  { stage: "prompts", message: "正在加载提示词配置" },
  { stage: "analysis", message: "正在加载分析结果" },
  { stage: "proofreading", message: "正在加载校对运行态" },
  { stage: "task", message: "正在加载任务状态" },
];

// RowBlock 字段顺序由 renderer 直接消费，不能在调用点临时拼装。
const FILES_BLOCK_FIELDS = ["rel_path", "file_type", "sort_index"] as const;
// items 字段顺序覆盖校对、任务和文件预览共同读取的最小条目事实。
const ITEMS_BLOCK_FIELDS = [
  "item_id",
  "file_path",
  "row_number",
  "src",
  "dst",
  "name_src",
  "name_dst",
  "status",
  "text_type",
  "retry_count",
] as const;

/**
 * Electron main 侧项目运行态编码器，只做请求内快照，不持有长期项目缓存。
 */
export class ProjectRuntimeEncoder {
  // database 是工程事实唯一读源，编码器不能直接持有 SQLite handle。
  private readonly database: ProjectDatabase;

  // task block 由 TaskSnapshotBuilder 组装，避免 bootstrap 回调旧公开任务路由。
  private readonly task_snapshot_builder: TaskSnapshotBuilder;

  // 公开 project block 由 会话状态持有，避免 bootstrap 回读历史会话 缓存。
  private readonly session_state: ProjectSessionState;

  /**
   * 注入 database workflow 与任务快照构建器，保持读取边界可测试。
   */
  public constructor(
    database: ProjectDatabase,
    task_snapshot_builder: TaskSnapshotBuilder,
    session_state: ProjectSessionState,
  ) {
    this.database = database;
    this.task_snapshot_builder = task_snapshot_builder;
    this.session_state = session_state;
  }

  /**
   * 一次性构建完整 bootstrap 事件序列，供 Gateway 在写流前完成失败判定。
   */
  public async build_bootstrap_events(): Promise<BootstrapSseEvent[]> {
    const project_state = this.session_state.snapshot();
    const project_path = project_state.loaded ? project_state.projectPath : "";
    const meta = project_path === "" ? {} : this.get_all_meta(project_path);
    const items_snapshot =
      project_path === ""
        ? this.empty_items_snapshot()
        : this.build_runtime_items_snapshot(project_path);
    const task_snapshot = await this.task_snapshot_builder.build_task_snapshot();
    // 所有 stage payload 先构建完成再交给 Gateway 写流，避免失败时产生半截成功 SSE。
    const stage_payloads: Record<RuntimeSection, MutableJsonRecord> = {
      project: this.build_project_block(project_state),
      files: this.build_files_block(project_path, items_snapshot),
      items: this.build_items_block(items_snapshot),
      quality:
        project_path === ""
          ? this.build_empty_quality_block()
          : this.build_quality_block(project_path, meta),
      prompts:
        project_path === ""
          ? this.build_empty_prompts_block()
          : this.build_prompts_block(project_path, meta),
      analysis:
        project_path === ""
          ? this.build_empty_analysis_block()
          : this.build_analysis_block(project_path, meta, items_snapshot),
      proofreading: this.build_proofreading_block(meta),
      task: task_snapshot,
    };
    const section_revisions = build_section_revisions_from_meta(meta);
    const events: BootstrapSseEvent[] = [];
    for (const { stage, message } of BOOTSTRAP_STAGE_DEFINITIONS) {
      events.push({ event: "stage_started", data: { stage, message } });
      events.push({ event: "stage_payload", data: { stage, payload: stage_payloads[stage] } });
      events.push({ event: "stage_completed", data: { stage } });
    }
    events.push({
      event: "completed",
      data: {
        projectRevision: Math.max(...Object.values(section_revisions), 0),
        sectionRevisions: section_revisions,
      },
    });
    return events;
  }

  /**
   * 给同步 mutation 复用同一 ProjectMutationAck revision 口径。
   */
  public build_project_mutation_ack(
    project_path: string,
    updated_sections: string[],
  ): MutableJsonRecord {
    return build_project_mutation_ack_from_meta(this.get_all_meta(project_path), updated_sections);
  }

  /**
   * project block 只暴露加载态和路径，其他会话细节继续留在主进程。
   */
  private build_project_block(project_state: {
    loaded: boolean;
    projectPath: string;
  }): MutableJsonRecord {
    return {
      project: {
        path: project_state.projectPath,
        loaded: project_state.loaded,
      },
    };
  }

  /**
   * files block 优先使用 asset 表顺序；旧工程缺 asset 时回退 item 首次出现顺序。
   */
  private build_files_block(project_path: string, snapshot: RuntimeItemsSnapshot): RowBlock {
    const asset_records = project_path === "" ? [] : this.get_asset_records(project_path);
    const rows: ApiJsonValue[][] = [];
    if (asset_records.length > 0) {
      for (const asset_record of asset_records) {
        const rel_path = asset_record.rel_path;
        rows.push([
          rel_path,
          snapshot.records_by_path.get(rel_path)?.file_type ?? "NONE",
          asset_record.sort_index,
        ]);
      }
      return { fields: [...FILES_BLOCK_FIELDS], rows };
    }
    for (const [sort_index, record] of [...snapshot.records_by_path.values()].entries()) {
      rows.push([record.rel_path, record.file_type, sort_index]);
    }
    return { fields: [...FILES_BLOCK_FIELDS], rows };
  }

  /**
   * items block 只输出前端需要的稳定行字段，隔离数据库 item JSON 的内部扩展字段。
   */
  private build_items_block(snapshot: RuntimeItemsSnapshot): RowBlock {
    return {
      fields: [...ITEMS_BLOCK_FIELDS],
      rows: snapshot.item_records.map((record) =>
        ITEMS_BLOCK_FIELDS.map((field) => record[field] ?? null),
      ),
    };
  }

  /**
   * 质量块按公开 rule type 输出，避免页面理解数据库里的旧物理命名。
   */
  private build_quality_block(project_path: string, meta: JsonRecord): MutableJsonRecord {
    return Object.fromEntries(
      QUALITY_RULE_TYPES.map((rule_type) => [
        rule_type,
        this.build_quality_rule_slice(project_path, meta, rule_type),
      ]),
    ) as MutableJsonRecord;
  }

  /**
   * 工程未加载时仍返回完整质量块形状，保持 bootstrap stage payload 可合并。
   */
  private build_empty_quality_block(): MutableJsonRecord {
    return Object.fromEntries(
      QUALITY_RULE_TYPES.map((rule_type) => [
        rule_type,
        { entries: [], enabled: false, mode: "off", revision: 0 },
      ]),
    ) as MutableJsonRecord;
  }

  /**
   * 单个质量规则切片同时收口 entries、meta 与 revision，避免 UI 侧自行拼接。
   */
  private build_quality_rule_slice(
    project_path: string,
    meta: JsonRecord,
    rule_type: QualityRuleType,
  ): MutableJsonRecord {
    const enabled_meta_key = resolve_quality_rule_enabled_meta_key(rule_type);
    return {
      entries: this.get_rule_entries(
        project_path,
        resolve_quality_rule_database_type(rule_type),
      ) as unknown as ApiJsonValue,
      enabled: Boolean(
        rule_type === "text_preserve" || enabled_meta_key === null ? false : meta[enabled_meta_key],
      ),
      mode:
        rule_type === "text_preserve"
          ? normalize_text_preserve_mode(meta["text_preserve_mode"])
          : "off",
      revision: get_runtime_section_revision(meta, `quality:${rule_type}`),
    };
  }

  /**
   * 提示词块只暴露 translation / analysis 两类任务提示词，和质量规则 entries 分离。
   */
  private build_prompts_block(project_path: string, meta: JsonRecord): MutableJsonRecord {
    return Object.fromEntries(
      PROMPT_TASK_TYPES.map((task_type) => [
        task_type,
        {
          task_type,
          revision: get_runtime_section_revision(meta, `prompts:${task_type}`),
          meta: { enabled: Boolean(meta[build_prompt_enabled_meta_key(task_type)] ?? false) },
          text: this.get_rule_text(project_path, resolve_prompt_database_type(task_type)),
        },
      ]),
    ) as MutableJsonRecord;
  }

  /**
   * 工程未加载时仍返回固定提示词形状，避免前端为未加载态写特殊解析分支。
   */
  private build_empty_prompts_block(): MutableJsonRecord {
    return Object.fromEntries(
      PROMPT_TASK_TYPES.map((task_type) => [
        task_type,
        { task_type, revision: 0, meta: { enabled: false }, text: "" },
      ]),
    ) as MutableJsonRecord;
  }

  /**
   * analysis block 把持久化 extras、候选池和当前 item 覆盖率组合成最小运行态。
   */
  private build_analysis_block(
    project_path: string,
    meta: JsonRecord,
    snapshot: RuntimeItemsSnapshot,
  ): MutableJsonRecord {
    return {
      extras: this.normalize_object(meta["analysis_extras"]),
      candidate_count: this.read_number(meta["analysis_candidate_count"], 0),
      candidate_aggregate: this.build_candidate_aggregate(project_path),
      status_summary: this.build_analysis_status_summary(project_path, snapshot),
    };
  }

  /**
   * 工程未加载时输出零值摘要，保持分析页初始化输入稳定。
   */
  private build_empty_analysis_block(): MutableJsonRecord {
    return {
      extras: {},
      candidate_count: 0,
      candidate_aggregate: {},
      status_summary: { total_line: 0, processed_line: 0, error_line: 0, line: 0 },
    };
  }

  /**
   * proofreading block 目前只需要 revision，真实条目事实仍由 items block 表达。
   */
  private build_proofreading_block(meta: JsonRecord): MutableJsonRecord {
    return {
      revision: get_runtime_section_revision(meta, "proofreading"),
    };
  }

  /**
   * 一次读取 item 表并派生文件索引，让 files/items 在同一 bootstrap 中自洽。
   */
  private build_runtime_items_snapshot(project_path: string): RuntimeItemsSnapshot {
    const item_records: MutableJsonRecord[] = [];
    const records_by_path = new Map<string, { rel_path: string; file_type: string }>();
    for (const item of this.get_all_items(project_path)) {
      const record = this.normalize_item_record(item);
      item_records.push(record);
      const file_path = String(item["file_path"] ?? "");
      if (file_path !== "") {
        records_by_path.set(file_path, {
          rel_path: file_path,
          file_type: normalize_item_file_type(item["file_type"]),
        });
      }
    }
    return { item_records, records_by_path };
  }

  /**
   * 未加载工程使用空快照，避免 bootstrap 路径触碰空 projectPath 的数据库。
   */
  private empty_items_snapshot(): RuntimeItemsSnapshot {
    return { item_records: [], records_by_path: new Map() };
  }

  /**
   * 数据库 item JSON 转成公开 item 行记录，兼容旧状态和旧 row 字段名。
   */
  private normalize_item_record(item: JsonRecord): MutableJsonRecord {
    return {
      item_id: this.read_number(item["id"], 0),
      file_path: String(item["file_path"] ?? ""),
      row_number: this.read_number(item["row"], 0),
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      name_src: item["name_src"] ?? null,
      name_dst: item["name_dst"] ?? null,
      status: this.normalize_item_status(item["status"]),
      text_type: this.resolve_text_type_value(item),
      retry_count: this.read_number(item["retry_count"], 0),
    };
  }

  /**
   *旧数据缺少 text_type 时按历史 Item 的规则推断，保持筛选和保护规则输入一致。
   */
  private resolve_text_type_value(item: JsonRecord): string {
    if (item["text_type"] !== undefined && item["text_type"] !== null) {
      return this.read_enum_value(item["text_type"], "NONE");
    }
    const file_type = this.read_enum_value(item["file_type"], "NONE");
    if (file_type !== "XLSX" && file_type !== "KVJSON" && file_type !== "MESSAGEJSON") {
      return "NONE";
    }
    return infer_item_text_type_from_source(String(item["src"] ?? ""));
  }

  /**
   * 运行态只输出当前有效状态；历史处理中状态在首包里归一为可消费状态。
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    return normalize_item_status(value);
  }

  /**
   * 分析覆盖率按当前 item 文本重新计算，跳过状态和空 src 不能计入总量。
   */
  private build_analysis_status_summary(
    project_path: string,
    snapshot: RuntimeItemsSnapshot,
  ): MutableJsonRecord {
    const checkpoints = this.get_analysis_checkpoints(project_path);
    let total_line = 0;
    let processed_line = 0;
    let error_line = 0;
    for (const item of snapshot.item_records) {
      const status = String(item["status"] ?? "NONE");
      if (is_task_skipped_item_status(status)) {
        continue;
      }
      const item_id = this.read_number(item["item_id"], 0);
      if (item_id <= 0 || String(item["src"] ?? "").trim() === "") {
        continue;
      }
      total_line += 1;
      const checkpoint_status = checkpoints.get(item_id) ?? "NONE";
      if (checkpoint_status === "PROCESSED") {
        processed_line += 1;
      } else if (checkpoint_status === "ERROR") {
        error_line += 1;
      }
    }
    return {
      total_line,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 候选聚合以 src 为 key 输出，匹配历史 AnalysisCandidateService 的公开快照。
   */
  private build_candidate_aggregate(project_path: string): MutableJsonRecord {
    const rows = this.database.execute(
      this.op("getAnalysisCandidateAggregates", { projectPath: project_path }),
    );
    if (!Array.isArray(rows)) {
      return {};
    }
    const aggregate: MutableJsonRecord = {};
    for (const row of rows) {
      const entry = this.normalize_candidate_aggregate_entry(row);
      if (entry !== null) {
        aggregate[String(entry["src"])] = entry;
      }
    }
    return aggregate;
  }

  /**
   * 候选池单项要过滤空 src 和无译文票数项，避免导入术语预演看到不可用候选。
   */
  private normalize_candidate_aggregate_entry(value: ApiJsonValue): MutableJsonRecord | null {
    if (!this.is_record(value)) {
      return null;
    }
    const src = String(value["src"] ?? "").trim();
    const dst_votes = this.normalize_vote_map(value["dst_votes"]);
    if (src === "" || Object.keys(dst_votes).length === 0) {
      return null;
    }
    const info_votes = this.normalize_vote_map(value["info_votes"]);
    const observation_vote_count = Object.values(dst_votes).reduce<number>(
      (sum, count) => sum + this.read_number(count, 0),
      0,
    );
    return {
      src,
      dst_votes,
      info_votes,
      observation_count: Math.max(
        this.read_number(value["observation_count"], 0),
        observation_vote_count,
        1,
      ),
      first_seen_at: String(value["first_seen_at"] ?? ""),
      last_seen_at: String(value["last_seen_at"] ?? ""),
      case_sensitive: Boolean(value["case_sensitive"] ?? false),
      first_seen_index: this.read_number(value["first_seen_index"], 0),
    };
  }

  /**
   * 票数 map 合并重复 key 并剔除非正票数，保持候选池排序和 winner 选择稳定。
   */
  private normalize_vote_map(value: ApiJsonValue | undefined): MutableJsonRecord {
    if (!this.is_record(value)) {
      return {};
    }
    const votes: MutableJsonRecord = {};
    for (const [raw_key, raw_value] of Object.entries(value)) {
      const key = raw_key.trim();
      const count = this.read_number(raw_value, 0);
      if (key !== "" && count > 0) {
        votes[key] = count + this.read_number(votes[key], 0);
      }
    }
    return votes;
  }

  /**
   * 读取全部 item 仍只通过 ProjectDatabase workflow，保持 SQL 落点集中。
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
   * asset 顺序来自 database workflow；这里兼容 path/sort_order 与旧 rel_path/sort_index 名。
   */
  private get_asset_records(project_path: string): Array<{ rel_path: string; sort_index: number }> {
    const value = this.database.execute(
      this.op("getAllAssetRecords", { projectPath: project_path }),
    );
    if (!Array.isArray(value)) {
      return [];
    }
    const records: Array<{ rel_path: string; sort_index: number }> = [];
    const seen_rel_paths = new Set<string>();
    for (const raw_record of value) {
      if (!this.is_record(raw_record)) {
        continue;
      }
      const rel_path = String(raw_record["path"] ?? raw_record["rel_path"] ?? "").trim();
      if (rel_path === "" || seen_rel_paths.has(rel_path)) {
        continue;
      }
      seen_rel_paths.add(rel_path);
      records.push({
        rel_path,
        sort_index: Math.max(
          0,
          this.read_number(raw_record["sort_order"] ?? raw_record["sort_index"], 0),
        ),
      });
    }
    return records;
  }

  /**
   * 规则 entries 允许旧库里出现非对象项，统一包装成可序列化记录。
   */
  private get_rule_entries(project_path: string, rule_type: string): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getRules", { projectPath: project_path, ruleType: rule_type }),
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => (this.is_record(entry) ? { ...entry } : { value: entry }));
  }

  /**
   * 提示词文本走规则文本 workflow，避免 runtime encoder 知道 rules 表物理细节。
   */
  private get_rule_text(project_path: string, rule_type: string): string {
    return String(
      this.database.execute(
        this.op("getRuleText", { projectPath: project_path, ruleType: rule_type }),
      ) ?? "",
    );
  }

  /**
   * checkpoint 以 item_id 建索引，分析摘要只需要当前覆盖状态而不暴露更新时间。
   */
  private get_analysis_checkpoints(project_path: string): Map<number, string> {
    const value = this.database.execute(
      this.op("getAnalysisItemCheckpoints", { projectPath: project_path }),
    );
    const checkpoints = new Map<number, string>();
    if (!Array.isArray(value)) {
      return checkpoints;
    }
    for (const row of value) {
      if (!this.is_record(row)) {
        continue;
      }
      const item_id = this.read_number(row["item_id"], 0);
      const status = this.normalize_checkpoint_status(row["status"]);
      if (item_id > 0 && status !== null) {
        checkpoints.set(item_id, status);
      }
    }
    return checkpoints;
  }

  /**
   * checkpoint 状态只接受任务进度三态，其它坏值按缺失处理。
   */
  private normalize_checkpoint_status(value: ApiJsonValue | undefined): string | null {
    const status = this.read_enum_value(value, "");
    return (TASK_PROGRESS_STATUSES as readonly string[]).includes(status) ? status : null;
  }

  /**
   * meta 是 revision 与运行态 extras 的共同来源，读取后只在本次请求内复用。
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * 枚举字段从旧库读出时可能不是字符串，统一转成公开字符串值。
   */
  private read_enum_value(value: ApiJsonValue | undefined, fallback: string): string {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return fallback;
  }

  /**
   * 运行态数字坏值回退到调用方给定默认值，避免 NaN 进入 SSE payload。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 只把普通对象当作 JSON record，避免数组或 null 被误当 meta / row。
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 类型收窄集中在一个入口，减少各 builder 里重复写对象判断。
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * database operation 在编码器内统一创建，避免操作名和参数形状散落。
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
