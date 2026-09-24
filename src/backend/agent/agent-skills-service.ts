import { AGENT_SKILL_MAIN_FILE } from "../../shared/agent-skills";
import { normalize_agent_skill_settings } from "../../domain/agent-skill-settings";
import path from "node:path";
import { is_json_record, type JsonRecord } from "../../domain/json";
import { default_native_fs as fs } from "../../native/native-fs";
import type {
  AgentSkillsSnapshot,
  AgentSkillFile,
  AgentSkillTree,
  AgentSkillIdentity,
  AgentSkillDocument,
  AgentSkillFileChange,
} from "../../shared/agent-skills";
import {
  read_skill_tree,
  read_skill_file,
  skill_existing_path,
  validate_skill_entry_name,
  write_skill_file,
  change_skill_file,
} from "./agent-skill-files";
import { write_agent_skill_document } from "./agent-skill-document";
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

  private pending: Promise<unknown> = Promise.resolve(); // 技能修改、查询共用顺序，改名期间不暴露半成品。

  /** 串行处理管理命令，并将文件系统错误转换为公开错误。 */
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action).catch((cause: unknown) => {
      if (cause instanceof AppError) throw cause;
      if (
        cause instanceof Error &&
        "code" in cause &&
        (cause.code === "ENOENT" || cause.code === "ENOTDIR")
      ) {
        throw new AppError("file.not_found", { cause });
      }
      throw new AppError("file.io_failed", { cause });
    });
    // 失败只交给本次调用方，队列继续受理后续重试。
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 读取当前技能的可管理文件树。 */
  public tree(request: JsonRecord): Promise<AgentSkillTree> {
    return this.serial(async () => {
      const { root, skill } = await this.locate(request);
      return { skill, entries: read_skill_tree(root) };
    });
  }

  /** 返回文件内容和本次读取的版本，供后续保存校验。 */
  public read_file(request: JsonRecord): Promise<AgentSkillFile> {
    return this.serial(async () => {
      const { root, skill } = await this.locate(request);
      if (typeof request.path !== "string") throw new AppError("request.validation_failed");
      return read_skill_file(root, skill, request.path);
    });
  }

  /** 校验文件操作意图，完成后返回最新目录。 */
  public change_file(request: JsonRecord): Promise<AgentSkillTree> {
    return this.serial(async () => {
      const { root, skill } = await this.locate(request, true);
      const { operation, path: relative, destination } = request;
      if (typeof relative !== "string") throw new AppError("request.validation_failed");
      let change: AgentSkillFileChange;
      if (operation === "move" && typeof destination === "string")
        change = { operation, path: relative, destination };
      else if (
        operation === "create_file" ||
        operation === "create_directory" ||
        operation === "delete"
      )
        change = { operation, path: relative };
      else throw new AppError("request.validation_failed");
      change_skill_file(root, change);
      return { skill, entries: read_skill_tree(root) };
    });
  }

  /** 保存当前版本的草稿，主文件改名同时迁移目录与偏好。 */
  public save_file(request: JsonRecord): Promise<AgentSkillFile> {
    return this.serial(async () => {
      const { root, skill, packages } = await this.locate(request, true);
      if (typeof request.path !== "string" || typeof request.revision !== "string")
        throw new AppError("request.validation_failed");
      const current = read_skill_file(root, skill, request.path);
      if (current.text === null) throw new AppError("file.invalid_structure");
      if (current.revision !== request.revision) throw new AppError("data.revision_conflict");
      let text: string;
      let document: AgentSkillDocument | undefined;
      if (request.path === AGENT_SKILL_MAIN_FILE) {
        const value = request.document;
        if (
          !is_json_record(value) ||
          typeof value.name !== "string" ||
          typeof value.description !== "string" ||
          typeof value.body !== "string"
        )
          throw new AppError("request.validation_failed");
        document = { name: value.name, description: value.description, body: value.body };
        text = write_agent_skill_document(current.text, document);
      } else {
        if (typeof request.text !== "string") throw new AppError("request.validation_failed");
        text = request.text;
      }
      const target = skill_existing_path(root, request.path);
      if (!document || document.name === skill.name) {
        write_skill_file(target, text);
        return read_skill_file(root, skill, request.path);
      }
      // 名称与目录名是加载契约；目录、正文和偏好在同一命令内更新并补偿。
      validate_skill_entry_name(document.name);
      const next_root = path.join(path.dirname(root), document.name);
      if (
        fs.exists(next_root) ||
        packages.some((item) => item.source === "user" && item.definition.name === document.name)
      )
        throw new AppError("file.already_exists");
      const setting = this.settings.read_setting();
      const preferences = normalize_agent_skill_settings(setting.agent_skills);
      const replace_name = (names: string[]) => [
        ...new Set(names.map((name) => (name === skill.name ? document.name : name))),
      ];
      let renamed = false; // 补偿时决定是否恢复目录。
      let saving_settings = false; // 配置写入可能部分失败，补偿须恢复旧配置。
      try {
        write_skill_file(target, text);
        fs.rename(root, next_root);
        renamed = true;
        saving_settings = true;
        this.settings.save_setting({
          ...setting,
          agent_skills: {
            disabled: { ...preferences.disabled, user: replace_name(preferences.disabled.user) },
            user_order: replace_name(preferences.user_order),
          },
        });
      } catch (cause) {
        try {
          if (renamed) fs.rename(next_root, root);
          write_skill_file(target, current.text);
          if (saving_settings) this.settings.save_setting(setting);
        } catch (rollback) {
          throw new AggregateError([cause, rollback], "Skill rename and rollback failed.", {
            cause,
          });
        }
        throw cause;
      }
      this.settings.publish_settings_changed(["agent_skills"]);
      return read_skill_file(next_root, { ...skill, name: document.name }, request.path);
    });
  }

  /** 从同一次扫描中定位真实技能包并检查来源权限。 */
  private async locate(
    request: JsonRecord,
    writable = false,
  ): Promise<{ root: string; skill: AgentSkillIdentity; packages: AgentSkillPackage[] }> {
    if (
      (request.source !== "builtin" && request.source !== "user") ||
      typeof request.name !== "string" ||
      (writable && request.source !== "user")
    )
      throw new AppError("request.validation_failed");
    const skill: AgentSkillIdentity = { source: request.source, name: request.name };
    const packages = await scan_agent_skills(this.paths, this.log);
    const selected = packages.find(
      (item) =>
        item.source === skill.source &&
        item.definition.name === skill.name &&
        item.definition.visible,
    );
    if (!selected) throw new AppError("file.not_found");
    // 来源入口可以经过目录链接，后续命令统一使用确认过的真实技能包路径。
    const root = fs.real_path(path.dirname(selected.definition.filePath));
    const source_root =
      skill.source === "user"
        ? this.paths.get_agent_user_skill_dir()
        : this.paths.get_agent_builtin_skill_dir();
    const relative = path.relative(fs.real_path(source_root), root);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    )
      throw new AppError("request.validation_failed");
    return { root, skill, packages };
  }
  /** 每次查询扫描磁盘，使重新进入页面能看到外部文件变更。 */
  public snapshot(): Promise<AgentSkillsSnapshot> {
    return this.serial(async () =>
      this.build_snapshot(await scan_agent_skills(this.paths, this.log)),
    );
  }

  /** 只修改指定来源的公开技能，保留同名另一来源的偏好。 */
  public set_enabled(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    return this.serial(async () => {
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
    });
  }

  /** 校验用户技能完整排列后保存，暂时缺失的名称继续保留。 */
  public reorder(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    return this.serial(async () => {
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
    });
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

/** GUI Gateway 仅消费技能管理公开命令。 */
export type AgentSkillsApi = Pick<
  AgentSkillsService,
  "snapshot" | "set_enabled" | "reorder" | "tree" | "read_file" | "save_file" | "change_file"
>;
