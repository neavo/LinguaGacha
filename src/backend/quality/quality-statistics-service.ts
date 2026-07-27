import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import type { QualityStatisticsCache } from "../cache/quality-statistics-cache";
import type { ProjectSessionState } from "../project/project-session-state";
import * as AppErrors from "../../shared/error";
import type { QualityStatisticsRuleMode } from "../../shared/quality/quality-statistics";

// 公开统计入口只允许这四类规则，内部 revision key 不得由请求透传。
const QUALITY_STATISTICS_RULE_KEYS = new Set<string>([
  "glossary",
  "pre_replacement",
  "post_replacement",
  "text_preserve",
]);

/**
 * 将质量统计请求绑定当前 loaded 工程，并交给统计缓存计算。
 */
export class QualityStatisticsService {
  private readonly session_state: ProjectSessionState; // 统一拒绝空会话查询
  private readonly cache: QualityStatisticsCache; // 拥有按依赖快照复用统计结果的策略

  /**
   * 注入会话守卫和统计缓存，不持有数据库写能力。
   */
  public constructor(options: {
    sessionState: ProjectSessionState;
    cache: QualityStatisticsCache;
  }) {
    this.session_state = options.sessionState;
    this.cache = options.cache;
  }

  /**
   * 返回统计结果及其对应的工程身份和 section revision。
   */
  public async read(request: JsonRecord): Promise<MutableJsonRecord> {
    this.session_state.require_loaded_project_path();
    const rule_key = this.read_rule_key(request["rule_key"]);
    const result = await this.cache.read(rule_key);
    return {
      projectPath: result.projectPath,
      sectionRevisions: result.sectionRevisions as unknown as JsonValue,
      statistics: result.statistics as unknown as JsonValue,
    };
  }

  /**
   * 将公开 rule_key 收窄为统计模块支持的稳定枚举。
   */
  private read_rule_key(value: JsonValue | undefined): QualityStatisticsRuleMode {
    const rule_key = String(value ?? "");
    if (QUALITY_STATISTICS_RULE_KEYS.has(rule_key)) {
      return rule_key as QualityStatisticsRuleMode;
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_quality_statistics_rule_key", rule_key },
    });
  }
}
