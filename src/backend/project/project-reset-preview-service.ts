import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import { ProjectDatabase } from "../database/database-operations";
import { FileFormatService } from "../file/file-format-service";
import { Item } from "../../domain/item";
import { is_json_record, read_json_integer } from "../../domain/json";
import { normalize_setting_snapshot } from "../../domain/setting";

import * as AppErrors from "../../shared/error";
import { ProjectSessionState } from "./project-session-state";
import type { RuntimeOperationGate } from "../runtime-operation-gate";

/**
 * 承载公开 reset preview；当前服务负责预演响应和 asset 重解析
 */
export class ProjectResetPreviewService {
  /**
   * reset preview 只读数据库，不负责提交真实 reset 写入
   */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly runtime_gate: RuntimeOperationGate,
    private readonly session_state: ProjectSessionState,
  ) {}

  /**
   * 翻译 all reset 需要重新解析原始 asset，但预览 id 分配和响应壳由 当前服务持有
   */
  public async preview_translation_reset(request: JsonRecord): Promise<JsonRecord> {
    const mode = String(request["mode"] ?? "").toLowerCase();
    if (mode !== "all") {
      throw new AppErrors.AppError("request.validation_failed");
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
      ) as unknown as JsonValue,
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
   * reset 预演和真实 reset 一样要求工程已加载且后台任务空闲
   */
  private async require_idle_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.AppError("project.not_loaded");
    }
    this.runtime_gate.assert_runtime_idle();
    return state.projectPath;
  }

  /**
   * 读取 asset 顺序用于复现 create/reset 时的文件排序
   */
  private get_asset_records(project_path: string): Array<{ path: string; sort_order: number }> {
    const value = this.database.get_all_asset_records(project_path);
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => is_json_record(item))
      .map((item) => ({
        path: String(item["path"] ?? ""),
        sort_order: read_json_integer(item["sort_order"], 0),
      }))
      .filter((item) => item.path !== "")
      .sort((left, right) => left.sort_order - right.sort_order);
  }

  /**
   * 重置预演只需要 item 当前事实，读取后复制一份避免误改数据库返回对象
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.get_all_items(project_path);
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => is_json_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * reset all 只重置内容，当前 item 身份必须由 file_path + row 显式保留。
   */
  private build_current_item_id_by_identity(project_path: string): Map<string, number> {
    const item_id_by_identity = new Map<string, number>();
    for (const item of this.get_all_items(project_path)) {
      const item_id = read_json_integer(item["id"], 0);
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
    const row = read_json_integer(item["row"] ?? item["row_number"], NaN);
    if (file_path === "" || !Number.isInteger(row) || row < 0) {
      return null;
    }
    return `${file_path}\u0000${row}`;
  }

  /**
   * 文件解析返回字段需要收敛到公开 item payload，避免数据库预览泄漏内部结构
   */
  private normalize_item_payload(item: JsonRecord, fallback_file_path: string): MutableJsonRecord {
    return {
      ...item,
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      row: read_json_integer(item["row"] ?? item["row_number"], 0),
      file_path: String(item["file_path"] ?? fallback_file_path),
      file_type: String(item["file_type"] ?? "NONE"),
      text_type: String(item["text_type"] ?? "NONE"),
      status: this.normalize_item_status(item["status"]),
      retry_count: read_json_integer(item["retry_count"], 0),
      skip_internal_filter: item["skip_internal_filter"] === true,
    };
  }

  /**
   * 重置预演只接受当前状态枚举，非法值按未处理状态兜底
   */
  private normalize_item_status(value: JsonValue | undefined): string {
    return Item.normalize_status(value);
  }

  /**
   * reset all 身份不一致时统一返回请求校验失败，调用方可按诊断原因定位数据问题。
   */
  private throw_translation_reset_identity_error(
    reason: string,
    diagnostic_context: JsonRecord = {},
  ): never {
    throw new AppErrors.AppError("request.validation_failed", {
      diagnostic_context: {
        reason,
        ...diagnostic_context,
      },
    });
  }
}
