import type { ApiJsonValue } from "../api/api-types";
import type { ProofreadingCache } from "./proofreading-cache";
import type { ProjectSessionState } from "../project/project-session";
import * as AppErrors from "../../shared/error";
import type {
  ProofreadingFilterOptions,
  ProofreadingSearchScope,
} from "../../shared/proofreading/proofreading-types";
import type { ProofreadingListViewQuery } from "../../shared/proofreading/proofreading-read-model";
import type { ProofreadingSortState } from "../../shared/proofreading/proofreading-list-runtime";

type MutableJsonRecord = Record<string, ApiJsonValue>;

export class ProofreadingQueryService {
  private readonly session_state: ProjectSessionState;
  private readonly cache: ProofreadingCache;

  public constructor(options: { sessionState: ProjectSessionState; cache: ProofreadingCache }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
  }

  public async read(request: Record<string, ApiJsonValue>): Promise<MutableJsonRecord> {
    this.require_loaded_project_path();
    const action = String(request["action"] ?? "sync");
    if (action === "sync") {
      const result = await this.cache.sync({
        sourceLanguage: request["source_language"],
        targetLanguage: request["target_language"],
      });
      return this.with_revision(result, {
        syncState: result.data as unknown as ApiJsonValue,
        defaultFilters: result.data.defaultFilters as unknown as ApiJsonValue,
      });
    }
    if (action === "list") {
      const result = await this.cache.list(this.read_list_query(request["query"]));
      return this.with_revision(result, { view: result.data as unknown as ApiJsonValue });
    }
    if (action === "window") {
      const result = await this.cache.window({
        view_id: String(request["view_id"] ?? ""),
        start: this.read_number(request["start"], 0),
        count: this.read_number(request["count"], 160),
      });
      return this.with_revision(result, { window: result.data as unknown as ApiJsonValue });
    }
    if (action === "row_ids_range") {
      const result = await this.cache.rowIdsRange({
        view_id: String(request["view_id"] ?? ""),
        start: this.read_number(request["start"], 0),
        count: this.read_number(request["count"], 160),
      });
      return this.with_revision(result, { row_ids: result.data as unknown as ApiJsonValue });
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
      return this.with_revision(result, { rows: result.data as unknown as ApiJsonValue });
    }
    if (action === "filter_panel") {
      const result = await this.cache.filterPanel({
        filters: this.read_filters(request["filters"]),
      });
      return this.with_revision(result, { filterPanel: result.data as unknown as ApiJsonValue });
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_proofreading_query_action", action },
    });
  }

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
      sectionRevisions: result.sectionRevisions as unknown as ApiJsonValue,
      ...data,
    };
  }

  private read_list_query(value: ApiJsonValue | undefined): ProofreadingListViewQuery {
    const record = this.read_record(value);
    return {
      filters: this.read_filters(record["filters"] as ApiJsonValue | undefined),
      keyword: String(record["keyword"] ?? ""),
      scope: this.read_scope(record["scope"]),
      is_regex: record["is_regex"] === true,
      sort_state: this.read_sort_state(record["sort_state"]),
      window_start: this.read_number(record["window_start"], 0),
      window_count: this.read_number(record["window_count"], 160),
    };
  }

  private read_filters(value: ApiJsonValue | undefined): ProofreadingFilterOptions {
    const record = this.read_record(value);
    return {
      warning_types: this.read_string_array(record["warning_types"] as ApiJsonValue | undefined),
      statuses: this.read_string_array(record["statuses"] as ApiJsonValue | undefined),
      file_paths: this.read_string_array(record["file_paths"] as ApiJsonValue | undefined),
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

  private read_scope(value: unknown): ProofreadingSearchScope {
    return value === "src" || value === "dst" ? value : "all";
  }

  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  private read_record(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, ApiJsonValue>)
      : {};
  }

  private read_string_array(value: ApiJsonValue | undefined): string[] {
    return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
  }

  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  }
}
