import type { ApiJsonValue } from "../api/api-types";
import type { QualityStatisticsCache } from "../cache/quality/quality-statistics-cache";
import type { ProjectSessionState } from "../project/project-session";
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
  private readonly cache: QualityStatisticsCache;

  public constructor(options: {
    sessionState: ProjectSessionState;
    cache: QualityStatisticsCache;
  }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
  }

  public async read(request: Record<string, ApiJsonValue>): Promise<MutableJsonRecord> {
    this.require_loaded_project_path();
    const rule_key = this.read_rule_key(request["rule_key"]);
    const result = await this.cache.read(rule_key);
    return {
      projectPath: result.projectPath,
      sectionRevisions: result.sectionRevisions as unknown as ApiJsonValue,
      statistics: result.statistics as unknown as ApiJsonValue,
    };
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
