import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { FileFormatService } from "../file/file-format-service";
import { item_to_json } from "../file/file-item";
import { TaskRuntimeState } from "../task/task-runtime-state";
import { ProjectSessionState } from "./project-session-state";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

// reset preview 只接受当前 ItemStatus 字面量，历史状态在 normalize 阶段折叠。
const VALID_ITEM_STATUS_VALUES = new Set([
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

// 分析总数排除这些不会进入分析任务的状态，保持预演和真实任务摘要一致。
const ANALYSIS_SKIPPED_STATUSES = new Set([
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

/**
 * 承载公开 reset preview；当前服务负责预演响应和 asset 重解析。
 */
export class ProjectResetPreviewService {
  /**
   * reset preview 只读数据库，不负责提交真实 reset mutation。
   */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly task_runtime_state: TaskRuntimeState,
    private readonly session_state: ProjectSessionState,
  ) {}

  /**
   * 翻译 all reset 需要重新解析原始 asset，但预览 id 分配和响应壳由 当前服务持有。
   */
  public async preview_translation_reset(request: JsonRecord): Promise<JsonRecord> {
    const mode = String(request["mode"] ?? "").toLowerCase();
    if (mode !== "all") {
      throw new Error("translation reset preview 仅支持 mode=all");
    }
    const project_path = await this.require_idle_project_path();
    const asset_records = this.get_asset_records(project_path);
    const parsed_files = await this.parse_database_assets(
      project_path,
      asset_records.map((record) => record.path),
    );
    const items: MutableJsonRecord[] = [];
    for (const file of parsed_files) {
      for (const item of file.items) {
        items.push(this.normalize_item_payload(item, file.rel_path));
      }
    }
    const preview_ids = this.preview_replace_all_item_ids(project_path, items);
    return {
      items: items.map((item, index) => ({
        ...item,
        id: preview_ids[index] ?? item["id"] ?? 0,
      })) as unknown as ApiJsonValue,
    };
  }

  /**
   * 所有公开 asset 都在 文件域重解析，数据库仍是 asset bytes 的唯一读取边界。
   */
  private async parse_database_assets(
    project_path: string,
    rel_paths: string[],
  ): Promise<Array<{ rel_path: string; items: JsonRecord[] }>> {
    const format_service = new FileFormatService({
      source_language: "JA",
      target_language: "ZH",
    });
    const parsed_files: Array<{ rel_path: string; items: JsonRecord[] }> = [];
    for (const rel_path of rel_paths) {
      const content = this.database.read_asset_content(project_path, rel_path);
      if (content === null) {
        parsed_files.push({ rel_path, items: [] });
        continue;
      }
      const items = await format_service.parse_asset(rel_path, content);
      parsed_files.push({ rel_path, items: items.map(item_to_json) });
    }
    return parsed_files;
  }

  /**
   * 分析 failed reset 的预演只移除 ERROR checkpoint，不触碰候选池或 item 事实。
   */
  public async preview_analysis_reset(request: JsonRecord): Promise<JsonRecord> {
    const mode = String(request["mode"] ?? "").toLowerCase();
    if (mode !== "failed") {
      throw new Error("analysis reset preview 仅支持 mode=failed");
    }
    const project_path = await this.require_idle_project_path();
    const checkpoints = this.get_analysis_checkpoints(project_path);
    let total_line = 0;
    let processed_line = 0;
    for (const item of this.get_all_items(project_path)) {
      const status = this.normalize_item_status(item["status"]);
      if (ANALYSIS_SKIPPED_STATUSES.has(status)) {
        continue;
      }
      const item_id = this.read_number(item["id"], 0);
      if (item_id <= 0 || String(item["src"] ?? "").trim() === "") {
        continue;
      }
      total_line += 1;
      if (checkpoints.get(item_id) === "PROCESSED") {
        processed_line += 1;
      }
    }
    return {
      status_summary: {
        total_line,
        processed_line,
        error_line: 0,
        line: processed_line,
      },
    };
  }

  /**
   * reset 预演和真实 reset 一样要求工程已加载且后台任务空闲。
   */
  private async require_idle_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    if (this.task_runtime_state.snapshot().busy) {
      throw new Error("任务正在执行中 …");
    }
    return state.projectPath;
  }

  /**
   * 读取 asset 顺序用于复现 create/reset 时的文件排序。
   */
  private get_asset_records(project_path: string): Array<{ path: string; sort_order: number }> {
    const value = this.database.execute(
      this.op("getAllAssetRecords", { projectPath: project_path }),
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => ({
        path: String(item["path"] ?? ""),
        sort_order: this.read_number(item["sort_order"], 0),
      }))
      .filter((item) => item.path !== "")
      .sort((left, right) => left.sort_order - right.sort_order);
  }

  /**
   * 分析预演只需要 item 当前事实，读取后复制一份避免误改数据库返回对象。
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
   * ERROR checkpoint 会在真实 failed reset 中被删除，预演据此计算剩余进度。
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
      const status = String(row["status"] ?? "");
      if (item_id > 0 && (status === "PROCESSED" || status === "ERROR")) {
        checkpoints.set(item_id, status);
      }
    }
    return checkpoints;
  }

  /**
   * 向数据库申请 replace-all 的预览 id，确保前端看到的 id 与真实 mutation 规则一致。
   */
  private preview_replace_all_item_ids(project_path: string, items: MutableJsonRecord[]): number[] {
    const value = this.database.execute(
      this.op("previewReplaceAllItemIds", {
        projectPath: project_path,
        items: items as unknown as DatabaseJsonValue,
      }),
    );
    return Array.isArray(value) ? value.map((item_id) => this.read_number(item_id, 0)) : [];
  }

  /**
   * 文件解析返回字段需要收敛到公开 item payload，避免数据库预览泄漏内部结构。
   */
  private normalize_item_payload(item: JsonRecord, fallback_file_path: string): MutableJsonRecord {
    return {
      ...item,
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      row: this.read_number(item["row"] ?? item["row_number"], 0),
      file_path: String(item["file_path"] ?? fallback_file_path),
      file_type: String(item["file_type"] ?? "NONE"),
      text_type: String(item["text_type"] ?? "NONE"),
      status: this.normalize_item_status(item["status"]),
      retry_count: this.read_number(item["retry_count"], 0),
    };
  }

  /**
   * 历史运行态状态在预演中折叠为当前状态枚举，避免旧工程扰动统计。
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    const status = String(value ?? "NONE");
    if (status === "PROCESSED_IN_PAST") {
      return "PROCESSED";
    }
    if (status === "PROCESSING") {
      return "NONE";
    }
    return VALID_ITEM_STATUS_VALUES.has(status) ? status : "NONE";
  }

  /**
   * SQLite/JSON 数字统一截断为整数，避免 id 和 row 出现小数。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 数据库 JSON 返回只允许对象继续进入业务归一化。
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 数据库操作名和参数集中封装，减少调用点重复对象形状。
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
