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

/**
 * ToolboxNameFieldExtractionService 从 session 缓存构造名称字段提取查询视图。
 */
export class ToolboxNameFieldExtractionService {
  private readonly session_state: ProjectSessionState; // 提供当前 loaded project 身份。
  private readonly cache: CacheReadPort; // 读取 item 和质量规则快照的唯一入口。
  private readonly worker_client: BackendWorkerClient; // 执行名称字段提取计算。

  /**
   * 注入 session、缓存和 worker，服务本身不持有数据库写入口。
   */
  public constructor(options: {
    sessionState: ProjectSessionState;
    cache: CacheReadPort;
    workerClient: BackendWorkerClient;
  }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
    this.worker_client = options.workerClient;
  }

  /**
   * 读取名称字段提取视图，并回传当前 section revision 供页面写入校验。
   */
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

  /**
   * 从 API 入参读取筛选条件，非法 scope 回到 all。
   */
  private read_filter(value: ApiJsonValue | undefined): NameFieldFilterState {
    const record = this.read_record(value);
    const scope = record["scope"];
    return {
      keyword: String(record["keyword"] ?? ""),
      scope: scope === "src" || scope === "dst" ? scope : "all",
      is_regex: record["is_regex"] === true,
    };
  }

  /**
   * 从 API 入参读取排序条件，非法组合回到无排序。
   */
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

  /**
   * 把未知 JSON 值收窄为普通对象。
   */
  private read_record(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, ApiJsonValue>)
      : {};
  }

  /**
   * 工具箱查询必须依赖已加载项目，空会话直接抛出项目未加载错误。
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }
}
