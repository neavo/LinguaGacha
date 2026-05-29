import type { BackendWorkerClient } from "../../worker/worker-client";
import * as AppErrors from "../../../shared/error";
import type { QualityStatisticsRuleMode } from "../../../shared/quality/quality-statistics";
import type { ProjectDataSectionRevisions } from "../../../shared/project-event";
import type { CacheChange } from "../cache-change";
import type { CacheReadPort } from "../cache-types";

export type QualityStatisticsCacheResult = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  statistics: Record<string, unknown>;
};

export class QualityStatisticsCache {
  private readonly cache: CacheReadPort;
  private readonly worker_client: BackendWorkerClient;
  private readonly values = new Map<string, Record<string, unknown>>();
  private readonly pending = new Map<string, Promise<Record<string, unknown>>>();

  public constructor(options: { cache: CacheReadPort; workerClient: BackendWorkerClient }) {
    this.cache = options.cache;
    this.worker_client = options.workerClient;
  }

  public async read(rule_key: QualityStatisticsRuleMode): Promise<QualityStatisticsCacheResult> {
    const section_revisions = this.cache.readSectionRevisions();
    const snapshot = this.cache.snapshot();
    if (snapshot.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    const cache_key = JSON.stringify({
      project_path: snapshot.projectPath,
      items: Number(section_revisions.items ?? 0),
      quality: Number(section_revisions.quality ?? 0),
      rule_key,
    });
    const cached = this.values.get(cache_key);
    if (cached !== undefined) {
      return {
        projectPath: snapshot.projectPath,
        sectionRevisions: section_revisions,
        statistics: cached,
      };
    }
    const statistics = await this.compute(cache_key, rule_key);
    return {
      projectPath: snapshot.projectPath,
      sectionRevisions: section_revisions,
      statistics,
    };
  }

  public clear(): void {
    this.values.clear();
    this.pending.clear();
  }

  public applyChange(change: CacheChange): void {
    if (change.items.mode !== "keep" || change.quality.mode === "full") {
      this.clear();
    }
  }

  private async compute(
    cache_key: string,
    rule_key: QualityStatisticsRuleMode,
  ): Promise<Record<string, unknown>> {
    const pending = this.pending.get(cache_key);
    if (pending !== undefined) {
      return pending;
    }
    const quality_block = this.cache.quality.readBlock();
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
          items: this.cache.items.readItems(),
        },
      },
      new AbortController().signal,
    );
    this.pending.set(cache_key, promise);
    try {
      const result = await promise;
      this.values.set(cache_key, result);
      return result;
    } finally {
      this.pending.delete(cache_key);
    }
  }
}
