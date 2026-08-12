import path from "node:path";

import {
  err,
  FileError,
  loadSkills,
  ok,
  toError,
  type FileErrorCode,
  type FileInfo,
  type Result,
  type Skill,
  type SkillDiagnostic,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import { is_json_record } from "../../domain/json";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import type { AgentSkillDisplayDescriptions } from "../../shared/agent";
import { LOCALES } from "../../shared/i18n/types";
import type { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";

const UI_FILE_NAME = "ui.json";
const REFERENCES_DIR_NAME = "references";

export type AgentSkillReference = {
  path: string; // 相对 skill 根目录的 POSIX 路径，供正文解析相对引用
  filePath: string; // 规范化绝对路径，作为 read_skill 的运行期白名单 key
  content: string; // 启动期固定的完整正文，只在 read_skill 时下发
};

type AgentSkillUi = {
  visible: boolean; // 是否进入公开能力列表，不改变模型调用或读取权限
  order?: number; // 缺失时排在显式顺序之后，同类保持加载顺序
  displayDescriptions: AgentSkillDisplayDescriptions;
};

/** 保留 Pi skill 的模型调用语义，并附加启动期固定的 UI 配置与受控 references。 */
export type AgentSkillDefinition = Skill &
  AgentSkillUi & {
    references: AgentSkillReference[];
  };

type AgentSkillCatalogDefinition = Pick<
  AgentSkillDefinition,
  "name" | "description" | "filePath" | "disableModelInvocation"
>;
type AgentSkillInvocationDefinition = Pick<AgentSkillDefinition, "name" | "filePath" | "content">;

type AgentSkillLog = Pick<LogManager, "error" | "warning">;
type AgentSkillNativeFs = Pick<NativeFs, "read_dirents" | "read_text_file" | "stat">;
type AgentSkillPaths = Pick<
  AppPathService,
  "get_agent_builtin_skill_dir" | "get_agent_user_skill_dir" | "get_app_root"
>;

/**
 * 启动期加载内置与用户 skill；同名用户 skill 后加载并覆盖内置定义。
 */
export async function load_agent_skills(
  paths: AgentSkillPaths,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs = default_native_fs,
): Promise<AgentSkillDefinition[]> {
  try {
    const result = await loadSkills(
      new AgentSkillExecutionEnv({ cwd: paths.get_app_root() }, native_fs),
      [paths.get_agent_builtin_skill_dir(), paths.get_agent_user_skill_dir()],
    );
    for (const diagnostic of result.diagnostics) log_skill_diagnostic(log_manager, diagnostic);

    const invalid_paths = new Set(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code === "invalid_metadata")
        .map((diagnostic) => diagnostic.path),
    );
    const skills = new Map<string, AgentSkillDefinition>(); // 输入目录顺序就是同名 skill 的覆盖优先级
    for (const skill of result.skills) {
      if (invalid_paths.has(skill.filePath)) continue;
      skills.set(skill.name, {
        ...skill,
        ...load_skill_ui(skill, log_manager, native_fs),
        references: load_skill_references(skill.filePath, log_manager, native_fs),
      });
    }
    return [...skills.values()];
  } catch (error) {
    log_manager.error(t_main_log("app.diagnostic.agent.skill_load_failed"), {
      source: "agent",
      error,
    });
    return [];
  }
}

/** 产品只注入能力事实，skill 路由规则由 system prompt 唯一拥有。 */
export function format_agent_skills_for_system_prompt(
  skills: readonly AgentSkillCatalogDefinition[],
): string {
  const visible_skills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible_skills.length === 0) return "";
  return [
    "<available_skills>",
    ...visible_skills.flatMap((skill) => [
      "  <skill>",
      `    <name>${escape_agent_skill_xml(skill.name)}</name>`,
      `    <description>${escape_agent_skill_xml(skill.description)}</description>`,
      `    <location>${escape_agent_skill_xml(skill.filePath)}</location>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n");
}

/** 显式 marker 直接注入完整正文，不再附带 SDK 的第二套路由说明。 */
export function format_agent_skill_invocation(skill: AgentSkillInvocationDefinition): string {
  return `<skill name="${escape_agent_skill_xml(skill.name)}" location="${escape_agent_skill_xml(skill.filePath)}">\n${skill.content}\n</skill>`;
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
 * 同目录 ui.json 定义 UI 可见性、顺序与描述；缺失或整份无效时统一回退默认 UI 配置。
 */
function load_skill_ui(
  skill: Skill,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs,
): AgentSkillUi {
  const fallback: AgentSkillUi = {
    visible: true,
    displayDescriptions: Object.fromEntries(
      LOCALES.map((locale) => [locale, skill.description]),
    ) as AgentSkillDisplayDescriptions,
  };
  const file_path = path.join(path.dirname(skill.filePath), UI_FILE_NAME);
  let parsed: unknown;
  try {
    parsed = JSON.parse(native_fs.read_text_file(file_path)) as unknown;
  } catch (error) {
    if (!is_not_found_error(error)) {
      log_skill_ui_diagnostic(log_manager, skill.name, file_path, error);
    }
    return fallback;
  }

  if (!is_json_record(parsed)) {
    log_skill_ui_diagnostic(log_manager, skill.name, file_path, "格式无效");
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
    log_skill_ui_diagnostic(log_manager, skill.name, file_path, "格式无效");
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

/**
 * 递归读取 references 目录下的普通文件并形成进程内快照；符号链接不进入白名单。
 */
function load_skill_references(
  skill_file_path: string,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs,
): AgentSkillReference[] {
  const skill_dir = path.dirname(skill_file_path);
  const references: AgentSkillReference[] = [];
  collect_skill_references(
    skill_dir,
    path.join(skill_dir, REFERENCES_DIR_NAME),
    references,
    log_manager,
    native_fs,
  );
  return references.sort((left, right) => left.path.localeCompare(right.path));
}

/** 深度遍历受控 references 根；失败文件降级为诊断，不污染其它 skill。 */
function collect_skill_references(
  skill_dir: string,
  directory: string,
  references: AgentSkillReference[],
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs,
): void {
  let entries: ReturnType<AgentSkillNativeFs["read_dirents"]>;
  try {
    entries = native_fs.read_dirents(directory);
  } catch (error) {
    if (!is_not_found_error(error)) {
      log_manager.warning(t_main_log("app.diagnostic.agent.skill_resource_load_failed"), {
        source: "agent",
        context: { path: directory, error: String(error) },
      });
    }
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entry_path = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collect_skill_references(skill_dir, entry_path, references, log_manager, native_fs);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      references.push({
        path: normalize_path(path.relative(skill_dir, entry_path)),
        filePath: normalize_path(entry_path),
        content: native_fs.read_text_file(entry_path),
      });
    } catch (error) {
      log_manager.warning(t_main_log("app.diagnostic.agent.skill_resource_load_failed"), {
        source: "agent",
        context: { path: entry_path, error: String(error) },
      });
    }
  }
}

/** 缺失的可选 skill 资源不产生诊断，其它 IO 错误仍需显式暴露。 */
function is_not_found_error(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * pi-agent-core 的 skill walker 使用 POSIX 分隔符比较路径；适配器只复用它的协议解析，
 * 实际读取全部经过 NativeFs。符号链接不进入 skill 扫描，避免越过受控根或形成递归环。
 */
class AgentSkillExecutionEnv extends NodeExecutionEnv {
  /** 固定工作目录，并把第三方 loader 的所有文件访问收口到 NativeFs。 */
  public constructor(
    options: { cwd: string },
    private readonly native_fs: AgentSkillNativeFs,
  ) {
    super(options);
  }

  /** 第三方 loader 只拿 Result，真实读取仍统一经过 NativeFs。 */
  public override async readTextFile(
    file_path: string,
    abort_signal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    const resolved_path = this.resolve_path(file_path);
    if (abort_signal?.aborted) return err(new FileError("aborted", "aborted", resolved_path));
    try {
      return ok(this.native_fs.read_text_file(resolved_path));
    } catch (error) {
      return err(to_file_error(error, resolved_path));
    }
  }

  /** 只向 skill walker 暴露普通文件和目录，阻断其它平台文件类型。 */
  public override async fileInfo(file_path: string): Promise<Result<FileInfo, FileError>> {
    const resolved_path = this.resolve_path(file_path);
    try {
      const stats = this.native_fs.stat(resolved_path);
      const kind = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : null;
      if (kind === null) {
        return err(new FileError("invalid", "Unsupported skill file type.", resolved_path));
      }
      return ok({
        name: resolved_path.split("/").at(-1) ?? resolved_path,
        path: resolved_path,
        kind,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      } satisfies FileInfo);
    } catch (error) {
      return err(to_file_error(error, resolved_path));
    }
  }

  /** 目录枚举在进入递归前过滤符号链接，避免越过受控 skill 根。 */
  public override async listDir(
    directory: string,
    abort_signal?: AbortSignal,
  ): Promise<Result<FileInfo[], FileError>> {
    const resolved_path = this.resolve_path(directory);
    if (abort_signal?.aborted) return err(new FileError("aborted", "aborted", resolved_path));
    try {
      const file_infos: FileInfo[] = [];
      for (const entry of this.native_fs.read_dirents(resolved_path)) {
        if (entry.isSymbolicLink()) continue;
        const result = await this.fileInfo(path.join(resolved_path, entry.name));
        if (!result.ok) return result;
        file_infos.push(result.value);
      }
      return ok(file_infos);
    } catch (error) {
      return err(to_file_error(error, resolved_path));
    }
  }

  /** Pi 使用 POSIX 路径比较；所有绝对化结果在适配器边界统一转换。 */
  private resolve_path(file_path: string): string {
    return normalize_path(
      path.isAbsolute(file_path) ? file_path : path.resolve(this.cwd, file_path),
    );
  }
}

/** Pi skill 协议统一使用 POSIX 路径作为资源身份。 */
function normalize_path(file_path: string): string {
  return file_path.replaceAll("\\", "/");
}

/** 把 Node IO 错误收窄为 Pi loader 的稳定错误码，同时保留原始 cause。 */
function to_file_error(error: unknown, file_path: string): FileError {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  const mapped_code: FileErrorCode =
    code === "ENOENT"
      ? "not_found"
      : code === "EACCES" || code === "EPERM"
        ? "permission_denied"
        : code === "ENOTDIR"
          ? "not_directory"
          : code === "EISDIR"
            ? "is_directory"
            : "unknown";
  const cause = toError(error);
  return new FileError(mapped_code, cause.message, file_path, cause);
}

/** 第三方 loader 诊断统一进入应用日志，不阻断其它合法 skill。 */
function log_skill_diagnostic(log_manager: AgentSkillLog, diagnostic: SkillDiagnostic): void {
  log_manager.warning(t_main_log("app.diagnostic.agent.skill_resource_load_failed"), {
    source: "agent",
    context: {
      code: diagnostic.code,
      path: diagnostic.path,
      diagnostic_message: diagnostic.message,
    },
  });
}

/** skill UI 配置失败只降级当前 skill，并保留完整诊断上下文。 */
function log_skill_ui_diagnostic(
  log_manager: AgentSkillLog,
  skill_name: string,
  file_path: string,
  error: unknown,
): void {
  log_manager.warning(t_main_log("app.diagnostic.agent.skill_resource_load_failed"), {
    source: "agent",
    context: { skill: skill_name, path: file_path, error: String(error) },
  });
}
