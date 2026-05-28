import type { ApiJsonValue } from "../api/api-types";
import type { ProjectDataCache } from "../project/project-data";
import type { ProjectSessionState } from "../project/project-session";
import type { CoreWorkerClient } from "../worker/worker-client";
import * as AppErrors from "../../shared/error";
import type { QualityStatisticsRuleMode } from "../../shared/quality/quality-statistics";

type MutableJsonRecord = Record<string, ApiJsonValue>;

const QUALITY_STATISTICS_RULE_KEYS = new Set<string>([
  "glossary",
  "pre_replacement",
  "post_replacement",
  "text_preserve",
]);

export class QualityStatisticsService {
  private readonly session_state: ProjectSessionState;
  private readonly project_data_cache: ProjectDataCache;
  private readonly worker_client: CoreWorkerClient;
  private readonly cache = new Map<string, Record<string, unknown>>();
  private readonly pending = new Map<string, Promise<Record<string, unknown>>>();

  public constructor(options: {
    sessionState: ProjectSessionState;
    projectDataCache: ProjectDataCache;
    workerClient: CoreWorkerClient;
  }) {
    this.session_state = options.sessionState;
    this.project_data_cache = options.projectDataCache;
    this.worker_client = options.workerClient;
  }

  public async read(request: Record<string, ApiJsonValue>): Promise<MutableJsonRecord> {
    const project_path = this.require_loaded_project_path();
    const rule_key = this.read_rule_key(request["rule_key"]);
    const section_revisions = this.project_data_cache.readSectionRevisions();
    const cache_key = JSON.stringify({
      project_path,
      items: Number(section_revisions.items ?? 0),
      quality: Number(section_revisions.quality ?? 0),
      rule_key,
    });
    const cached = this.cache.get(cache_key);
    if (cached !== undefined) {
      return {
        projectPath: project_path,
        sectionRevisions: section_revisions as unknown as ApiJsonValue,
        statistics: cached as unknown as ApiJsonValue,
      };
    }
    const statistics = await this.compute(cache_key, rule_key);
    return {
      projectPath: project_path,
      sectionRevisions: section_revisions as unknown as ApiJsonValue,
      statistics: statistics as unknown as ApiJsonValue,
    };
  }

  public clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private async compute(
    cache_key: string,
    rule_key: QualityStatisticsRuleMode,
  ): Promise<Record<string, unknown>> {
    const pending = this.pending.get(cache_key);
    if (pending !== undefined) {
      return pending;
    }
    const quality_block = this.project_data_cache.readQualityBlock();
    const slice =
      typeof quality_block[rule_key] === "object" &&
      quality_block[rule_key] !== null &&
      !Array.isArray(quality_block[rule_key])
        ? (quality_block[rule_key] as Record<string, unknown>)
        : {};
    const entries = Array.isArray(slice["entries"])
      ? slice["entries"].flatMap((entry) => {
          return typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? [{ ...(entry as Record<string, unknown>) }]
            : [];
        })
      : [];
    const promise = this.worker_client.run(
      {
        type: "quality_statistics",
        input: {
          rule_key,
          entries,
          items: this.project_data_cache.readItems(),
        },
      },
      new AbortController().signal,
    );
    this.pending.set(cache_key, promise);
    try {
      const result = await promise;
      this.cache.set(cache_key, result);
      return result;
    } finally {
      this.pending.delete(cache_key);
    }
  }

  private read_rule_key(value: ApiJsonValue | undefined): QualityStatisticsRuleMode {
    const rule_key = String(value ?? "");
    if (QUALITY_STATISTICS_RULE_KEYS.has(rule_key)) {
      return rule_key as QualityStatisticsRuleMode;
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_quality_statistics_rule_key", rule_key },
    });
  }

  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }
}
