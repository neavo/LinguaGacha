import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { FileFormatService } from "../file/file-format-service";
import { Item } from "../../base/item";
import { normalize_setting_snapshot } from "../../base/setting";
import { is_task_skipped_item_status } from "../../shared/task";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { ProjectSessionState } from "./project-session-state";
import * as AppErrors from "../../shared/error";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

/**
 * 承载公开 reset preview；当前服务负责预演响应和 asset 重解析
 */
export class ProjectResetPreviewService {
  /**
   * reset preview 只读数据库，不负责提交真实 reset mutation
   */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly task_runtime_state: TaskRuntimeState,
    private readonly session_state: ProjectSessionState,
  ) {}

  /**
   * 翻译 all reset 需要重新解析原始 asset，但预览 id 分配和响应壳由 当前服务持有
   */
  public async preview_translation_reset(request: JsonRecord): Promise<JsonRecord> {
    const mode = String(request["mode"] ?? "").toLowerCase();
    if (mode !== "all") {
      throw new AppErrors.RequestValidationError();
    }
    const project_path = await this.require_idle_project_path();
    const asset_records = this.get_asset_records(project_path);
    const current_item_id_by_identity = this.build_current_item_id_by_identity(project_path);
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
    return {
      items: this.attach_current_item_ids(
        items,
        current_item_id_by_identity,
      ) as unknown as ApiJsonValue,
    };
  }

  /**
   * 所有公开 asset 都在 文件域重解析，数据库仍是 asset bytes 的唯一读取边界
   */
  private async parse_database_assets(
    project_path: string,
    rel_paths: string[],
  ): Promise<Array<{ rel_path: string; items: JsonRecord[] }>> {
    const default_settings = normalize_setting_snapshot({});
    const format_service = new FileFormatService({
      source_language: default_settings.source_language,
      target_language: default_settings.target_language,
    });
    const parsed_files: Array<{ rel_path: string; items: JsonRecord[] }> = [];
    for (const rel_path of rel_paths) {
      const content = this.database.read_asset_content(project_path, rel_path);
      if (content === null) {
        parsed_files.push({ rel_path, items: [] });
        continue;
      }
      const items = await format_service.parse_asset(rel_path, content);
      parsed_files.push({ rel_path, items: items.map((item) => Item.from_json(item).to_json()) });
    }
    return parsed_files;
  }

  /**
   * 分析 failed reset 的预演只移除 ERROR checkpoint，不触碰候选池或 item 事实
   */
  public async preview_analysis_reset(request: JsonRecord): Promise<JsonRecord> {
    const mode = String(request["mode"] ?? "").toLowerCase();
    if (mode !== "failed") {
      throw new AppErrors.RequestValidationError();
    }
    const project_path = await this.require_idle_project_path();
    const checkpoints = this.get_analysis_checkpoints(project_path);
    let total_line = 0;
    let processed_line = 0;
    for (const item of this.get_all_items(project_path)) {
      const status = this.normalize_item_status(item["status"]);
      if (is_task_skipped_item_status(status)) {
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
   * reset 预演和真实 reset 一样要求工程已加载且后台任务空闲
   */
  private async require_idle_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    if (this.task_runtime_state.snapshot().busy) {
      throw new AppErrors.TaskBusyError();
    }
    return state.projectPath;
  }

  /**
   * 读取 asset 顺序用于复现 create/reset 时的文件排序
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
   * 分析预演只需要 item 当前事实，读取后复制一份避免误改数据库返回对象
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
   * reset all 只重置内容，当前 item 身份必须由 file_path + row 显式保留。
   */
  private build_current_item_id_by_identity(project_path: string): Map<string, number> {
    const item_id_by_identity = new Map<string, number>();
    for (const item of this.get_all_items(project_path)) {
      const item_id = this.read_number(item["id"], 0);
      const identity_key = this.build_item_identity_key(item);
      if (item_id <= 0 || identity_key === null || item_id_by_identity.has(identity_key)) {
        this.throw_translation_reset_identity_error("current_item_identity_invalid");
      }
      item_id_by_identity.set(identity_key, item_id);
    }
    return item_id_by_identity;
  }

  /**
   * 预览结果按当前 item 身份回填 id，避免文件重排后按数组下标错配。
   */
  private attach_current_item_ids(
    items: MutableJsonRecord[],
    item_id_by_identity: Map<string, number>,
  ): MutableJsonRecord[] {
    if (items.length !== item_id_by_identity.size) {
      this.throw_translation_reset_identity_error("translation_reset_all_item_count_mismatch", {
        current_count: item_id_by_identity.size,
        preview_count: items.length,
      });
    }

    const used_identity_keys = new Set<string>();
    return items.map((item) => {
      const identity_key = this.build_item_identity_key(item);
      const item_id = identity_key === null ? undefined : item_id_by_identity.get(identity_key);
      if (identity_key === null || item_id === undefined || used_identity_keys.has(identity_key)) {
        this.throw_translation_reset_identity_error("preview_item_identity_mismatch");
      }
      used_identity_keys.add(identity_key);
      return {
        ...item,
        id: item_id,
      };
    });
  }

  /**
   * file_path + row 是 reset 重解析前后唯一稳定身份；空路径或非法行号直接视为不可重置。
   */
  private build_item_identity_key(item: JsonRecord): string | null {
    const file_path = String(item["file_path"] ?? "").trim();
    const row = this.read_number(item["row"] ?? item["row_number"], NaN);
    if (file_path === "" || !Number.isInteger(row) || row < 0) {
      return null;
    }
    return `${file_path}\u0000${row}`;
  }

  /**
   * ERROR checkpoint 会在真实 failed reset 中被删除，预演据此计算剩余进度
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
   * 文件解析返回字段需要收敛到公开 item payload，避免数据库预览泄漏内部结构
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
      skip_internal_filter: item["skip_internal_filter"] === true,
    };
  }

  /**
   * 重置预演只接受当前状态枚举，非法值按未处理状态兜底
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    return Item.normalize_status(value);
  }

  /**
   * SQLite/JSON 数字统一截断为整数，避免 id 和 row 出现小数
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * reset all 身份不一致时统一返回请求校验失败，调用方可按诊断原因定位数据问题。
   */
  private throw_translation_reset_identity_error(
    reason: string,
    diagnostic_context: Record<string, ApiJsonValue> = {},
  ): never {
    throw new AppErrors.RequestValidationError({
      diagnostic_context: {
        reason,
        ...diagnostic_context,
      },
    });
  }

  /**
   * 数据库 JSON 返回只允许对象继续进入业务归一化
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 数据库操作名和参数集中封装，减少调用点重复对象形状
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
