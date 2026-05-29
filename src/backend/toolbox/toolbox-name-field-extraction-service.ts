import type { ApiJsonValue } from "../api/api-types";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProjectSessionState } from "../project/project-session";
import type { BackendWorkerClient } from "../worker/worker-client";
import * as AppErrors from "../../shared/error";
import type {
  NameFieldFilterState,
  NameFieldSortState,
} from "../../shared/toolbox/name-field-extraction";

type MutableJsonRecord = Record<string, ApiJsonValue>;

export class ToolboxNameFieldExtractionService {
  private readonly session_state: ProjectSessionState;
  private readonly cache: CacheReadPort;
  private readonly worker_client: BackendWorkerClient;

  public constructor(options: {
    sessionState: ProjectSessionState;
    cache: CacheReadPort;
    workerClient: BackendWorkerClient;
  }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
    this.worker_client = options.workerClient;
  }

  public async read(request: Record<string, ApiJsonValue>): Promise<MutableJsonRecord> {
    const project_path = this.require_loaded_project_path();
    const section_revisions = this.cache.readSectionRevisions();
    const quality_block = this.cache.quality.readBlock();
    const glossary =
      typeof quality_block["glossary"] === "object" &&
      quality_block["glossary"] !== null &&
      !Array.isArray(quality_block["glossary"])
        ? (quality_block["glossary"] as Record<string, unknown>)
        : {};
    const glossary_entries = Array.isArray(glossary["entries"])
      ? glossary["entries"].flatMap((entry) => {
          return typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? [{ ...(entry as Record<string, unknown>) }]
            : [];
        })
      : [];
    const result = await this.worker_client.run(
      {
        type: "name_field_extraction",
        input: {
          items: this.cache.items.readItems(),
          glossary_entries,
          filter: this.read_filter(request["filter"]),
          sort: this.read_sort(request["sort"]),
        },
      },
      new AbortController().signal,
    );
    return {
      projectPath: project_path,
      sectionRevisions: section_revisions as unknown as ApiJsonValue,
      view: result as unknown as ApiJsonValue,
      glossary: { entries: glossary_entries } as unknown as ApiJsonValue,
    };
  }

  private read_filter(value: ApiJsonValue | undefined): NameFieldFilterState {
    const record = this.read_record(value);
    const scope = record["scope"];
    return {
      keyword: String(record["keyword"] ?? ""),
      scope: scope === "src" || scope === "dst" ? scope : "all",
      is_regex: record["is_regex"] === true,
    };
  }

  private read_sort(value: ApiJsonValue | undefined): NameFieldSortState {
    const record = this.read_record(value);
    const field = record["field"];
    const direction = record["direction"];
    if (
      (field === "src" || field === "dst") &&
      (direction === "ascending" || direction === "descending")
    ) {
      return { field, direction };
    }
    return { field: null, direction: null };
  }

  private read_record(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, ApiJsonValue>)
      : {};
  }

  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }
}
