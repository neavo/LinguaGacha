import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import { read_json_record } from "../../domain/json";
import type { ProofreadingCache } from "../cache/proofreading-cache";
import type { ProjectSessionState } from "../project/project-session-state";
import * as AppErrors from "../../shared/error";
import type {
  ProofreadingFilterOptions,
  ProofreadingSearchScope,
} from "../../shared/proofreading/proofreading-types";
import type { ProofreadingListViewQuery } from "../../shared/proofreading/proofreading-list-reader";
import type { ProofreadingSortState } from "../../shared/proofreading/list";

/**
 * 将校对页面 action 收窄为当前 loaded 工程的只读缓存查询。
 */
export class ProofreadingQueryService {
  private readonly session_state: ProjectSessionState; // 查询必须绑定当前 loaded 工程
  private readonly cache: ProofreadingCache; // 大列表计算和窗口身份由后端缓存拥有

  /**
   * 注入会话守卫和校对缓存，不为查询开放数据库写入口。
   */
  public constructor(options: { sessionState: ProjectSessionState; cache: ProofreadingCache }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
  }

  /**
   * 分发校对页唯一查询入口，未知 action 在协议边界直接拒绝。
   */
  public async query(request: JsonRecord): Promise<MutableJsonRecord> {
    this.session_state.require_loaded_project_path();
    const action = String(request["action"] ?? "sync");
    if (action === "sync") {
      const result = await this.cache.sync({
        sourceLanguage: request["source_language"],
        targetLanguage: request["target_language"],
      });
      return this.with_revision(result, {
        syncState: result.data as unknown as JsonValue,
        defaultFilters: result.data.defaultFilters as unknown as JsonValue,
      });
    }
    if (action === "list") {
      const result = await this.cache.list(this.read_list_query(request["query"]));
      return this.with_revision(result, { view: result.data as unknown as JsonValue });
    }
    if (action === "window") {
      const result = await this.cache.window({
        view_id: String(request["view_id"] ?? ""),
        start: this.read_number(request["start"], 0),
        count: this.read_number(request["count"], 160),
      });
      return this.with_revision(result, { window: result.data as unknown as JsonValue });
    }
    if (action === "row_ids_range") {
      const result = await this.cache.rowIdsRange({
        view_id: String(request["view_id"] ?? ""),
        start: this.read_number(request["start"], 0),
        count: this.read_number(request["count"], 160),
      });
      return this.with_revision(result, { row_ids: result.data as unknown as JsonValue });
    }
    if (action === "row_index") {
      const result = await this.cache.rowIndex({
        view_id: String(request["view_id"] ?? ""),
        row_id: String(request["row_id"] ?? ""),
      });
      return this.with_revision(result, { row_index: result.data });
    }
    if (action === "items_by_row_ids") {
      const result = await this.cache.itemsByRowIds({
        row_ids: this.read_string_array(request["row_ids"]),
      });
      return this.with_revision(result, { rows: result.data as unknown as JsonValue });
    }
    if (action === "context") {
      const result = await this.cache.context({
        row_id: String(request["row_id"] ?? ""),
      });
      return this.with_revision(result, { rows: result.data as unknown as JsonValue });
    }
    if (action === "filter_panel") {
      const result = await this.cache.filterPanel({
        filters: this.read_filters(request["filters"]),
      });
      return this.with_revision(result, { filterPanel: result.data as unknown as JsonValue });
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_proofreading_query_action", action },
    });
  }

  /**
   * 每个查询响应都携带计算时的工程身份和 section revision。
   */
  private with_revision(
    result: {
      projectPath: string;
      sectionRevisions: Record<string, unknown>;
      data: unknown;
    },
    data: MutableJsonRecord,
  ): MutableJsonRecord {
    return {
      projectPath: result.projectPath,
      sectionRevisions: result.sectionRevisions as unknown as JsonValue,
      ...data,
    };
  }

  /**
   * 将公开 list query 归一为校对列表读取器的完整参数。
   */
  private read_list_query(value: JsonValue | undefined): ProofreadingListViewQuery {
    const record = read_json_record(value);
    return {
      filters: this.read_filters(record["filters"] as JsonValue | undefined),
      keyword: String(record["keyword"] ?? ""),
      scope: this.read_scope(record["scope"]),
      is_regex: record["is_regex"] === true,
      sort_state: this.read_sort_state(record["sort_state"]),
      window_start: this.read_number(record["window_start"], 0),
      window_count: this.read_number(record["window_count"], 160),
    };
  }

  /**
   * 只接受稳定过滤字段；非法术语元组在边界丢弃。
   */
  private read_filters(value: JsonValue | undefined): ProofreadingFilterOptions {
    const record = read_json_record(value);
    return {
      warning_types: this.read_string_array(record["warning_types"] as JsonValue | undefined),
      statuses: this.read_string_array(record["statuses"] as JsonValue | undefined),
      file_paths: this.read_string_array(record["file_paths"] as JsonValue | undefined),
      glossary_terms: Array.isArray(record["glossary_terms"])
        ? record["glossary_terms"].flatMap((term) => {
            return Array.isArray(term) && term.length >= 2
              ? [[String(term[0] ?? ""), String(term[1] ?? "")] as const]
              : [];
          })
        : [],
      include_without_glossary_miss: record["include_without_glossary_miss"] !== false,
    };
  }

  /**
   * 排序必须同时具备合法方向和列 id，否则退回默认顺序。
   */
  private read_sort_state(value: unknown): ProofreadingSortState | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const direction = record["direction"];
    if (direction !== "ascending" && direction !== "descending") {
      return null;
    }
    return {
      column_id: String(record["column_id"] ?? ""),
      direction,
    };
  }

  /**
   * 搜索范围只允许原文、译文或两者。
   */
  private read_scope(value: unknown): ProofreadingSearchScope {
    return value === "src" || value === "dst" ? value : "all";
  }

  /**
   * 多选过滤统一转换为字符串数组。
   */
  private read_string_array(value: JsonValue | undefined): string[] {
    return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
  }

  /**
   * 窗口参数统一截断为非负整数。
   */
  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  }
}
