import { normalize_agent_skill_settings } from "../../domain/agent-skill-settings";
import type { JsonRecord } from "../../domain/json";
import type { AgentSkillsSnapshot } from "../../shared/agent-skills";
import { AppError } from "../../shared/error";
import type { AppSettingService } from "../app/app-setting-service";
import {
  scan_agent_skills,
  sort_agent_skill_packages,
  type AgentSkillPackage,
  type AgentSkillPaths,
  type AgentSkillLog,
} from "./agent-skills";

/** 技能管理拥有来源与名称校验和偏好命令，配置文件仍由 AppSettingService 唯一写入。 */
export class AgentSkillsService {
  /** 复用 GUI 组合根提供的路径、配置写入口和日志。 */
  public constructor(
    private readonly paths: AgentSkillPaths, // 两个技能来源的目录。
    private readonly settings: AppSettingService, // 应用配置的唯一写入者。
    private readonly log: AgentSkillLog, // 扫描诊断出口。
  ) {}

  /** 每次查询扫描磁盘，使重新进入页面能看到外部文件变更。 */
  public async snapshot(): Promise<AgentSkillsSnapshot> {
    return this.build_snapshot(await scan_agent_skills(this.paths, this.log));
  }

  /** 只修改指定来源的公开技能，保留同名另一来源的偏好。 */
  public async set_enabled(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    const packages = await scan_agent_skills(this.paths, this.log);
    const { source, name, enabled } = request;
    if (
      (source !== "builtin" && source !== "user") ||
      typeof name !== "string" ||
      typeof enabled !== "boolean" ||
      !packages.some(
        (item) =>
          item.source === source && item.definition.name === name && item.definition.visible,
      )
    ) {
      throw new AppError("request.validation_failed");
    }
    // 扫描完成后再读取最新偏好，同步读改写避免两个异步命令互相覆盖。
    const setting = this.settings.read_setting();
    const preferences = normalize_agent_skill_settings(setting.agent_skills);
    const disabled = new Set(preferences.disabled[source]);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    this.settings.save_setting({
      ...setting,
      agent_skills: {
        ...preferences,
        disabled: { ...preferences.disabled, [source]: [...disabled] },
      },
    });
    this.settings.publish_settings_changed(["agent_skills"]);
    return this.build_snapshot(packages);
  }

  /** 校验用户技能完整排列后保存，暂时缺失的名称继续保留。 */
  public async reorder(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    const packages = await scan_agent_skills(this.paths, this.log);
    const names = request.names;
    const current = packages
      .filter((item) => item.source === "user" && item.definition.visible)
      .map((item) => item.definition.name);
    if (
      !Array.isArray(names) ||
      names.length !== current.length ||
      new Set(names).size !== names.length ||
      !names.every((name): name is string => typeof name === "string" && current.includes(name))
    ) {
      throw new AppError("request.validation_failed");
    }
    const setting = this.settings.read_setting();
    const preferences = normalize_agent_skill_settings(setting.agent_skills);
    // 暂时缺失的技能保留排序偏好，重新出现时继续使用。
    const missing = preferences.user_order.filter((name) => !current.includes(name));
    this.settings.save_setting({
      ...setting,
      agent_skills: { ...preferences, user_order: [...names, ...missing] },
    });
    this.settings.publish_settings_changed(["agent_skills"]);
    return this.build_snapshot(packages);
  }

  /** 管理页展示两个来源的偏好，包含关闭或被覆盖的技能。 */
  private build_snapshot(packages: readonly AgentSkillPackage[]): AgentSkillsSnapshot {
    const preferences = normalize_agent_skill_settings(this.settings.read_setting().agent_skills);
    return {
      skills: sort_agent_skill_packages(packages, preferences)
        .filter((item) => item.definition.visible)
        .map((item) => ({
          name: item.definition.name,
          source: item.source,
          displayDescriptions: { ...item.definition.displayDescriptions },
          enabled: !preferences.disabled[item.source].includes(item.definition.name),
        })),
    };
  }
}
