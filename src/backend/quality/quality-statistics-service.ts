import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import type { QualityRuleAnalysisCache } from "../cache/quality-rule-analysis-cache";
import type { ProjectSessionState } from "../project/project-session-state";
import * as AppErrors from "../../shared/error";
import { is_quality_rule_kind, type QualityRuleKind } from "../../domain/quality";

/**
 * 将质量统计请求绑定当前 loaded 工程，并交给统计缓存计算。
 */
export class QualityStatisticsService {
  private readonly session_state: ProjectSessionState; // 统一拒绝空会话查询
  private readonly cache: Pick<QualityRuleAnalysisCache, "read">; // 只消费统一分析缓存的读出口

  /**
   * 注入会话守卫和统计缓存，不持有数据库写能力。
   */
  public constructor(options: {
    sessionState: ProjectSessionState;
    cache: Pick<QualityRuleAnalysisCache, "read">;
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
      statistics: {
        entry_ids: result.analysis.entry_ids,
        hits_by_entry_id: result.analysis.hits_by_entry_id,
        subset_parents_by_entry_id: result.analysis.relations.subset_parents_by_entry_id,
      } as unknown as JsonValue,
    };
  }

  /**
   * 将公开 rule_key 收窄为统计模块支持的稳定枚举。
   */
  private read_rule_key(value: JsonValue | undefined): QualityRuleKind {
    if (is_quality_rule_kind(value)) {
      return value;
    }
    throw new AppErrors.AppError("request.validation_failed", {
      diagnostic_context: { reason: "invalid_quality_statistics_rule_key", rule_key: value },
    });
  }
}
