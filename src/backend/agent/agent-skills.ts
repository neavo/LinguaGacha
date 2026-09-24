import { AGENT_SKILL_MAIN_FILE, AGENT_SKILL_UI_FILE } from "../../shared/agent-skills";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ignore, { type Ignore } from "ignore";
import { read_agent_skill_metadata } from "./agent-skill-document";

import { is_json_record } from "../../domain/json";
import {
  normalize_agent_skill_settings,
  type AgentSkillSettings,
} from "../../domain/agent-skill-settings";
import type { AgentSkillSource } from "../../shared/agent-skills";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import type { AgentSkillDisplayDescriptions } from "../../shared/agent";
import { LOCALES } from "../../shared/i18n/types";
import type { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";

type AgentSkillUi = {
  visible: boolean; // 是否进入公开能力列表并接受用户 marker，不改变模型自主调用或读取权限
  order?: number; // 内置展示顺序，缺失时按名称追加；用户顺序由应用偏好拥有
  displayDescriptions: AgentSkillDisplayDescriptions;
};

/** 名称是逻辑身份，文件路径只负责定位原包。 */
export type AgentSkillDefinition = AgentSkillUi & {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
};

type AgentSkillCatalogDefinition = Pick<
  AgentSkillDefinition,
  "name" | "description" | "disableModelInvocation"
>;

export type AgentSkillLog = Pick<LogManager, "warning">;
type AgentSkillNativeFs = Pick<NativeFs, "read_dirents" | "read_text_file">;
export type AgentSkillPaths = Pick<
  AppPathService,
  "get_agent_builtin_skill_dir" | "get_agent_user_skill_dir"
>;

export type AgentSkillPackage = {
  definition: AgentSkillDefinition; // 会话读取所需的包与元数据。
  source: AgentSkillSource; // 偏好身份与同名覆盖优先级。
};

/** 扫描技能并按偏好选择每个名称的启用来源。 */
export function load_agent_skills(
  paths: AgentSkillPaths,
  log_manager: AgentSkillLog,
  settings: AgentSkillSettings = normalize_agent_skill_settings(undefined),
  native_fs: AgentSkillNativeFs = default_native_fs,
): AgentSkillDefinition[] {
  const packages = scan_agent_skills(paths, log_manager, native_fs);
  return select_agent_skills(packages, settings);
}

/** 管理命令与会话读取共用启用、同名覆盖和排序规则。 */
export function select_agent_skills(
  packages: readonly AgentSkillPackage[],
  settings: AgentSkillSettings,
): AgentSkillDefinition[] {
  const selected = new Map<string, AgentSkillPackage>(); // 每个名称只绑定一个启用包。
  // 先过滤关闭项，再由用户包覆盖内置包。关闭用户包后回退到内置包。
  for (const item of packages) {
    if (item.definition.visible && settings.disabled[item.source].includes(item.definition.name))
      continue;
    if (!selected.has(item.definition.name) || item.source === "user")
      selected.set(item.definition.name, item);
  }
  return sort_agent_skill_packages([...selected.values()], settings).map((item) => item.definition);
}

/** 按来源保留首个有效同名包，跨来源覆盖由选择函数处理。 */
export function scan_agent_skills(
  paths: AgentSkillPaths,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs = default_native_fs,
): AgentSkillPackage[] {
  const skills: AgentSkillPackage[] = [];
  for (const source of ["builtin", "user"] as const) {
    const root =
      source === "builtin" ? paths.get_agent_builtin_skill_dir() : paths.get_agent_user_skill_dir();
    const names = new Map<string, string>(); // 按路径顺序保留首个有效同名包。
    for (const filePath of discover_skill_files(root, log_manager, native_fs).sort((a, b) =>
      a.localeCompare(b),
    )) {
      let metadata: ReturnType<typeof read_agent_skill_metadata>;
      try {
        metadata = read_agent_skill_metadata(native_fs.read_text_file(filePath));
      } catch (error) {
        log_skill_failure(log_manager, error, { path: filePath });
        continue;
      }
      const previous = names.get(metadata.name);
      if (previous) {
        log_skill_failure(log_manager, "技能名称重复，已跳过后发现的技能", {
          name: metadata.name,
          path: filePath,
          selected: previous,
        });
        continue;
      }
      names.set(metadata.name, filePath);
      const { name, description, disableModelInvocation } = metadata;
      const skill = {
        name,
        description,
        disableModelInvocation,
        filePath: filePath.replaceAll("\\", "/"),
      };
      skills.push({
        source,
        definition: { ...skill, ...load_skill_ui(skill, log_manager, native_fs) },
      });
    }
  }
  return skills;
}

const SKILL_IGNORE_FILES = [".gitignore", ".ignore", ".fdignore"] as const;

/** 链接只允许作为来源入口；发现主文件后即到达包边界。忽略规则按所在目录继承。 */
function discover_skill_files(root: string, log: AgentSkillLog, fs: AgentSkillNativeFs): string[] {
  const files: string[] = [];
  /** 每个目录追加自己的忽略规则，兄弟目录分别继承父级规则。 */
  const walk = (
    directory: string,
    parents: readonly { directory: string; matcher: Ignore }[],
  ): void => {
    let entries: ReturnType<AgentSkillNativeFs["read_dirents"]>;
    try {
      entries = fs.read_dirents(directory);
    } catch (error) {
      // 用户技能根允许尚未创建；已发现的分支访问失败仍需诊断。
      if (directory !== path.resolve(root) || !is_not_found_error(error))
        log_skill_failure(log, error, { path: directory });
      return;
    }
    const matcher = ignore();
    for (const name of SKILL_IGNORE_FILES) {
      if (!entries.some((entry) => entry.name === name && entry.isFile())) continue;
      const target = path.join(directory, name);
      try {
        matcher.add(fs.read_text_file(target));
      } catch (error) {
        log_skill_failure(log, error, { path: target });
      }
    }
    const rules = [...parents, { directory, matcher }];
    /** 从父到子应用规则，子目录的显式反选覆盖父级匹配。 */
    const ignored = (target: string, is_directory: boolean): boolean => {
      let ignored = false;
      for (const rule of rules) {
        const relative =
          path.relative(rule.directory, target).replaceAll("\\", "/") + (is_directory ? "/" : "");
        const result = rule.matcher.test(relative);
        if (result.ignored) ignored = true;
        else if (result.unignored) ignored = false;
      }
      return ignored;
    };
    const main = path.join(directory, AGENT_SKILL_MAIN_FILE);
    if (
      entries.some((entry) => entry.name === AGENT_SKILL_MAIN_FILE && entry.isFile()) &&
      !ignored(main, false)
    ) {
      files.push(main);
      return;
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules"
      )
        continue;
      const target = path.join(directory, entry.name);
      if (!ignored(target, true)) walk(target, rules);
    }
  };
  walk(path.resolve(root), []);
  return files;
}

/** 技能加载各阶段共用固定提示，异常与诊断详情交给日志系统呈现。 */
function log_skill_failure(
  log: AgentSkillLog,
  error: unknown,
  context: Record<string, unknown>,
): void {
  log.warning(t_main_log("app.diagnostic.agent.skill_load_failed"), {
    source: "agent",
    error,
    context,
  });
}

/** 内置顺序由资源决定，用户顺序由偏好决定；未排序的新技能按名称追加。 */
export function sort_agent_skill_packages(
  skills: readonly AgentSkillPackage[],
  settings: AgentSkillSettings,
): AgentSkillPackage[] {
  const user_order = new Map(settings.user_order.map((name, index) => [name, index]));
  // 两种顺序分别归资源和用户偏好拥有，缺省项统一追加。
  const rank = (skill: AgentSkillPackage): number =>
    skill.source === "builtin"
      ? (skill.definition.order ?? Number.MAX_SAFE_INTEGER)
      : (user_order.get(skill.definition.name) ?? Number.MAX_SAFE_INTEGER);
  return skills.toSorted((left, right) => {
    if (left.source !== right.source) return left.source === "builtin" ? -1 : 1;
    return rank(left) - rank(right) || left.definition.name.localeCompare(right.definition.name);
  });
}

/** 产品只注入能力事实，skill 路由规则由 system prompt 唯一拥有。 */
export function format_agent_skills_for_system_prompt(
  skills: readonly AgentSkillCatalogDefinition[],
): string {
  const model_skills = skills.filter((skill) => !skill.disableModelInvocation);
  if (model_skills.length === 0) return "";
  return [
    "<available_skills>",
    ...model_skills.flatMap((skill) => [
      "  <skill>",
      `    <name>${escape_agent_skill_xml(skill.name)}</name>`,
      `    <description>${escape_agent_skill_xml(skill.description)}</description>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n");
}

/** 技能地址始终指向原包根目录，供资源读取和脚本导入使用。 */
export function agent_skill_base_url(file_path: string): string {
  return pathToFileURL(path.dirname(file_path) + path.sep).href;
}

/** 只转义 XML 结构字段；skill 正文保持原始 Markdown。 */
function escape_agent_skill_xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * 同目录 ui.json 定义公开可调用性、顺序与描述；缺失或整份无效时统一回退默认 UI 配置。
 */
function load_skill_ui(
  skill: Pick<AgentSkillDefinition, "description" | "filePath">,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs,
): AgentSkillUi {
  const fallback: AgentSkillUi = {
    visible: true,
    displayDescriptions: Object.fromEntries(
      LOCALES.map((locale) => [locale, skill.description]),
    ) as AgentSkillDisplayDescriptions,
  };
  const file_path = path.join(path.dirname(skill.filePath), AGENT_SKILL_UI_FILE);
  let text: string;
  try {
    text = native_fs.read_text_file(file_path);
  } catch (error) {
    // 显示配置可省略；其它加载失败记录后使用默认配置。
    if (!is_not_found_error(error)) log_skill_failure(log_manager, error, { path: file_path });
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    log_skill_failure(log_manager, error, { path: file_path });
    return fallback;
  }

  if (!is_json_record(parsed)) {
    log_skill_failure(log_manager, "技能显示配置无效，已使用默认配置", { path: file_path });
    return fallback;
  }
  const visible = parsed["visible"];
  const order = parsed["order"];
  const descriptions = parsed["displayDescriptions"];
  const description_record = is_json_record(descriptions) ? descriptions : null;
  const description_entries = description_record === null ? [] : Object.entries(description_record);
  if (
    Object.keys(parsed).length === 0 ||
    Object.keys(parsed).some(
      (key) => key !== "visible" && key !== "order" && key !== "displayDescriptions",
    ) ||
    (visible !== undefined && typeof visible !== "boolean") ||
    (order !== undefined &&
      (typeof order !== "number" || !Number.isSafeInteger(order) || order < 0)) ||
    (descriptions !== undefined && description_record === null) ||
    description_entries.some(
      ([locale, description]) =>
        !LOCALES.some((supported_locale) => supported_locale === locale) ||
        typeof description !== "string" ||
        description.trim() === "",
    )
  ) {
    log_skill_failure(log_manager, "技能显示配置无效，已使用默认配置", { path: file_path });
    return fallback;
  }

  const display_descriptions = { ...fallback.displayDescriptions };
  for (const locale of LOCALES) {
    const description = description_record?.[locale];
    if (typeof description === "string") display_descriptions[locale] = description.trim();
  }
  return {
    visible: visible !== false,
    ...(typeof order === "number" ? { order } : {}),
    displayDescriptions: display_descriptions,
  };
}

/** 缺失的可选 skill 资源不产生诊断，其它 IO 错误仍需显式暴露。 */
function is_not_found_error(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
