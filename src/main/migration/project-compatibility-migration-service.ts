import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { ConfigService } from "../service/config-service";
import { is_text_preserve_mode } from "../../base/quality";
import { normalize_app_language } from "../../base/settings";

type MigrationMetaRecord = Record<string, DatabaseJsonValue>;

// 旧翻译提示词按语言拆成两个原始规则槽位，迁移时只读取一次。
const LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE = "CUSTOM_PROMPT_ZH";
const LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE = "CUSTOM_PROMPT_EN";
// 迁移标记避免用户清空当前提示词后被旧槽位反复写回。
const LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY = "translation_prompt_legacy_migrated";
// 当前工程只暴露单一 translation_prompt 物理槽位。
const TRANSLATION_PROMPT_RULE_TYPE = "translation_prompt";

/**
 * 统一承接工程加载期旧业务语义迁移，具体写入仍回到 database operation。
 */
export class ProjectCompatibilityMigrationService {
  private readonly database: ProjectDatabase;
  private readonly config_service: ConfigService;

  /**
   * 注入当前工程事实读写入口和应用语言来源，避免迁移服务自行解析全局状态。
   */
  public constructor(database: ProjectDatabase, config_service: ConfigService) {
    this.database = database;
    this.config_service = config_service;
  }

  /**
   * 构建打开旧工程时需要写回的兼容操作，调用方负责放入同一事务。
   */
  public build_open_compatibility_operations(project_path: string): DatabaseOperation[] {
    const meta = this.get_all_meta(project_path);
    const operations: DatabaseOperation[] = [];
    const raw_text_preserve_mode = this.string_value(meta["text_preserve_mode"]);
    // 旧工程只有 bool 开关；当前运行态必须持久化成 mode 枚举。
    if (!is_text_preserve_mode(raw_text_preserve_mode)) {
      operations.push(
        this.op("setMeta", {
          projectPath: project_path,
          key: "text_preserve_mode",
          value: this.boolean_value(meta["text_preserve_enable"]) ? "custom" : "smart",
        }),
      );
    }

    // 当前提示词优先级高于旧语言槽位，避免覆盖用户已经迁到新槽位的内容。
    if (!this.boolean_value(meta[LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY])) {
      const current_prompt = this.get_rule_text(project_path, TRANSLATION_PROMPT_RULE_TYPE).trim();
      const legacy_prompt =
        current_prompt === "" ? this.get_legacy_translation_prompt(project_path) : "";
      if (legacy_prompt !== "") {
        operations.push(
          this.op("setRuleText", {
            projectPath: project_path,
            ruleType: TRANSLATION_PROMPT_RULE_TYPE,
            text: legacy_prompt,
          }),
        );
      }
      operations.push(
        this.op("setMeta", {
          projectPath: project_path,
          key: LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY,
          value: true,
        }),
      );
    }
    return operations;
  }

  /**
   * 按当前应用语言优先读取旧 ZH/EN 翻译提示词槽位，保持旧迁移语义。
   */
  private get_legacy_translation_prompt(project_path: string): string {
    const config = this.config_service.load_config();
    const preferred_rule_types =
      normalize_app_language(config["app_language"]) === "EN"
        ? [LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE, LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE]
        : [LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE, LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE];
    for (const rule_type of preferred_rule_types) {
      const candidate = this.get_rule_text_by_name(project_path, rule_type).trim();
      if (candidate !== "") {
        return candidate;
      }
    }
    return "";
  }

  /**
   * 读取 meta 快照，迁移决策只基于打开瞬间的持久事实。
   */
  private get_all_meta(project_path: string): MigrationMetaRecord {
    return this.database.execute({
      name: "getAllMeta",
      args: { projectPath: project_path },
    }) as MigrationMetaRecord;
  }

  /**
   * 读取当前物理规则文本，用来判断是否还需要从旧槽位补写。
   */
  private get_rule_text(project_path: string, rule_type: string): string {
    return this.database.execute({
      name: "getRuleText",
      args: { projectPath: project_path, ruleType: rule_type },
    }) as string;
  }

  /**
   * 按原始规则名读取旧槽位文本，避免当前规则类型映射吞掉 legacy 名称。
   */
  private get_rule_text_by_name(project_path: string, rule_type_name: string): string {
    return this.database.execute({
      name: "getRuleTextByName",
      args: { projectPath: project_path, ruleTypeName: rule_type_name },
    }) as string;
  }

  /**
   * 迁移服务只构造受限 database operation，不直接触碰数据库句柄。
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }

  /**
   * meta 旧值可能缺失或类型漂移，迁移判断统一按空字符串兜底。
   */
  private string_value(value: DatabaseJsonValue | undefined): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * 旧 bool 字段只用于一次性迁移，缺失时按关闭处理。
   */
  private boolean_value(value: DatabaseJsonValue | undefined): boolean {
    return Boolean(value);
  }
}
