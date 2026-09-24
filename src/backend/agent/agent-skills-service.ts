import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { AGENT_SKILL_MAIN_FILE } from "../../shared/agent-skills";
import { normalize_agent_skill_settings } from "../../domain/agent-skill-settings";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
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
  write_skill_file,
  change_skill_file,
} from "./agent-skill-files";
import { write_agent_skill_document } from "./agent-skill-document";
import { AppError } from "../../shared/error";
import type { AppSettingService } from "../app/app-setting-service";
import {
  scan_agent_skills,
  load_agent_skills,
  select_agent_skills,
  type AgentSkillDefinition,
  sort_agent_skill_packages,
  type AgentSkillPackage,
  type AgentSkillPaths,
  type AgentSkillLog,
} from "./agent-skills";

/** 技能管理与会话读取共用串行入口和当前技能集合，配置仍由 AppSettingService 写入。 */
export class AgentSkillsService {
  /** 复用 GUI 组合根提供的路径、配置写入口和日志。 */
  public constructor(
    private readonly paths: AgentSkillPaths, // 两个技能来源的目录。
    private readonly settings: Pick<
      AppSettingService,
      "read_setting" | "save_setting" | "publish_settings_changed"
    >, // 应用配置的唯一写入者。
    private readonly log: AgentSkillLog, // 扫描诊断出口。
    private readonly runtime_gate: Pick<RuntimeOperationGate, "run_skill_write">, // 技能保存与 Agent 执行共用互斥入口。
  ) {}

  private pending: Promise<unknown> = Promise.resolve(); // 技能修改、查询共用顺序，改名期间不暴露半成品。
  private current: readonly AgentSkillDefinition[] = []; // 当前可用集合，由管理操作和显式扫描原子替换。
  private readonly listeners = new Set<() => void>(); // 当前集合变化时通知所有对话。

  /** 返回当前只读集合。 */
  public get_current(): readonly AgentSkillDefinition[] {
    return this.current;
  }

  /** 注册集合变更通知，调用方在关闭时取消订阅。 */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 启动、重置与首次受理在管理命令队列中读取最新磁盘和偏好。 */
  public refresh(): Promise<void> {
    return this.serial(() => this.refresh_current());
  }

  /** 在已持有的串行操作中扫描技能，供读取和保存复用。 */
  private refresh_current(): void {
    this.update_current(
      load_agent_skills(
        this.paths,
        this.log,
        normalize_agent_skill_settings(this.settings.read_setting().agent_skills),
      ),
    );
  }

  /** 仅在内容变化时替换不可变集合，避免重复发布技能集合。 */
  private update_current(skills: readonly AgentSkillDefinition[]): void {
    if (isDeepStrictEqual(this.current, skills)) return;
    this.current = Object.freeze(
      skills.map((skill) =>
        Object.freeze({
          ...skill,
          displayDescriptions: Object.freeze({ ...skill.displayDescriptions }),
        }),
      ),
    );
    for (const listener of this.listeners) listener();
  }

  /** 串行处理管理命令，并将文件系统错误转换为公开错误。 */
  private serial<T>(action: () => T | Promise<T>): Promise<T> {
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

  /** 持有占用直到文件、偏好和当前集合全部更新，避免模型请求看到中间状态。 */
  private write<T>(action: () => T | Promise<T>): Promise<T> {
    return this.serial(() => this.runtime_gate.run_skill_write(action));
  }

  /** 读取当前技能的可管理文件树。 */
  public tree(request: JsonRecord): Promise<AgentSkillTree> {
    return this.serial(() => {
      const { root, skill } = this.locate(request);
      return { skill, entries: read_skill_tree(root) };
    });
  }

  /** 返回文件内容和本次读取的版本，供后续保存校验。 */
  public read_file(request: JsonRecord): Promise<AgentSkillFile> {
    return this.serial(() => {
      const { root, skill } = this.locate(request);
      if (typeof request.path !== "string") throw new AppError("request.validation_failed");
      return read_skill_file(root, skill, request.path);
    });
  }

  /** 校验文件操作意图，完成后返回最新目录。 */
  public change_file(request: JsonRecord): Promise<AgentSkillTree> {
    return this.write(async () => {
      const { root, skill } = this.locate(request, true);
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
      await change_skill_file(root, change);
      return { skill, entries: read_skill_tree(root) };
    });
  }

  /** 保存当前版本的草稿，名称变化只迁移逻辑身份及偏好。 */
  public save_file(request: JsonRecord): Promise<AgentSkillFile> {
    return this.write(() => {
      const { root, skill, packages } = this.locate(request, true);
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
        if (document) this.refresh_current();
        return read_skill_file(root, skill, request.path);
      }
      if (packages.some((item) => item.source === "user" && item.definition.name === document.name))
        throw new AppError("file.already_exists");
      const setting = this.settings.read_setting();
      const preferences = normalize_agent_skill_settings(setting.agent_skills);
      // 名称偏好随元数据迁移，原目录继续定位资源。
      const replace_name = (names: string[]) => [
        ...new Set(names.map((name) => (name === skill.name ? document.name : name))),
      ];
      let saving_settings = false; // 配置写入可能部分失败，补偿须恢复旧配置。
      try {
        write_skill_file(target, text);
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
          write_skill_file(target, current.text);
          if (saving_settings) this.settings.save_setting(setting);
        } catch (rollback) {
          throw new AggregateError([cause, rollback], "Skill metadata save and rollback failed.", {
            cause,
          });
        }
        throw cause;
      }
      this.settings.publish_settings_changed(["agent_skills"]);
      this.refresh_current();
      return read_skill_file(root, { ...skill, name: document.name }, request.path);
    });
  }

  /** 磁盘删除完成后再清理当前偏好；失败只同步实际文件集合，已删除的内容无法回滚。 */
  public delete(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    return this.write(async () => {
      const { root, skill } = this.locate(request, true);
      try {
        await fs.remove_async(root, { recursive: true });
        // 等待期间其它应用设置可能变化，提交时读取最新值，避免覆盖无关修改。
        const setting = this.settings.read_setting();
        const preferences = normalize_agent_skill_settings(setting.agent_skills);
        this.settings.save_setting({
          ...setting,
          agent_skills: {
            disabled: {
              ...preferences.disabled,
              user: preferences.disabled.user.filter((name) => name !== skill.name),
            },
            user_order: preferences.user_order.filter((name) => name !== skill.name),
          },
        });
        const snapshot = this.update_snapshot(scan_agent_skills(this.paths, this.log));
        this.settings.publish_settings_changed(["agent_skills"]);
        return snapshot;
      } catch (error) {
        let cause = error;
        try {
          this.refresh_current();
        } catch (refresh) {
          cause = new AggregateError([error, refresh], "Skill deletion and refresh failed.", {
            cause: error,
          });
        }
        throw cause;
      }
    });
  }

  /** 从同一次扫描中定位真实技能包并检查来源权限。 */
  private locate(
    request: JsonRecord,
    writable = false,
  ): { root: string; skill: AgentSkillIdentity; packages: AgentSkillPackage[] } {
    if (
      (request.source !== "builtin" && request.source !== "user") ||
      typeof request.name !== "string" ||
      (writable && request.source !== "user")
    )
      throw new AppError("request.validation_failed");
    const skill: AgentSkillIdentity = { source: request.source, name: request.name };
    const packages = scan_agent_skills(this.paths, this.log);
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
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
      throw new AppError("request.validation_failed");
    return { root, skill, packages };
  }
  /** 每次查询扫描磁盘，使重新进入页面能看到外部文件变更。 */
  public snapshot(): Promise<AgentSkillsSnapshot> {
    return this.serial(() => this.update_snapshot(scan_agent_skills(this.paths, this.log)));
  }

  /** 只修改指定来源的公开技能，保留同名另一来源的偏好。 */
  public set_enabled(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    return this.write(() => {
      const packages = scan_agent_skills(this.paths, this.log);
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
      // 在串行命令内读取和保存当前偏好，避免命令间覆盖。
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
      return this.update_snapshot(packages);
    });
  }

  /** 校验用户技能完整排列后保存，暂时缺失的名称继续保留。 */
  public reorder(request: JsonRecord): Promise<AgentSkillsSnapshot> {
    return this.write(() => {
      const packages = scan_agent_skills(this.paths, this.log);
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
      return this.update_snapshot(packages);
    });
  }

  /** 同一次扫描更新可用集合，并返回含关闭项和被覆盖来源的管理快照。 */
  private update_snapshot(packages: readonly AgentSkillPackage[]): AgentSkillsSnapshot {
    const preferences = normalize_agent_skill_settings(this.settings.read_setting().agent_skills);
    this.update_current(select_agent_skills(packages, preferences));
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
  | "snapshot"
  | "set_enabled"
  | "reorder"
  | "tree"
  | "read_file"
  | "save_file"
  | "change_file"
  | "delete"
>;
