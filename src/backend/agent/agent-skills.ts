import path from "node:path";

import {
  BACKGROUND_CONTEXT,
  err,
  FileError,
  loadSkills,
  ok,
  toError,
  type Context,
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

type AgentSkillUi = {
  visible: boolean; // 是否进入公开能力列表并接受用户 marker，不改变模型自主调用或读取权限
  order?: number; // 缺失时排在显式顺序之后，同类保持加载顺序
  displayDescriptions: AgentSkillDisplayDescriptions;
};

/** 会话 skill 快照保留 Pi 路由语义、冻结正文与产品 UI 投影。 */
export type AgentSkillDefinition = Pick<
  Skill,
  "name" | "description" | "filePath" | "disableModelInvocation"
> &
  AgentSkillUi & { content: string };

type AgentSkillCatalogDefinition = Pick<
  AgentSkillDefinition,
  "name" | "description" | "disableModelInvocation"
>;
type AgentSkillInvocationDefinition = Pick<AgentSkillDefinition, "name" | "content">;

export type AgentSkillLog = Pick<LogManager, "error" | "warning">;
type AgentSkillNativeFs = Pick<NativeFs, "read_dirents" | "read_text_file" | "stat">;
export type AgentSkillPaths = Pick<
  AppPathService,
  "get_agent_builtin_skill_dir" | "get_agent_user_skill_dir" | "get_app_root"
>;

/** 按 Pi 的 first-wins 语义加载会话 catalog；用户有效定义优先于内置定义。 */
export async function load_agent_skills(
  paths: AgentSkillPaths,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs = default_native_fs,
): Promise<AgentSkillDefinition[]> {
  try {
    const execution_env = new AgentSkillExecutionEnv({ cwd: paths.get_app_root() }, native_fs);
    const sources = [paths.get_agent_user_skill_dir(), paths.get_agent_builtin_skill_dir()];
    const skills = new Map<string, AgentSkillDefinition>();
    for (const source of sources) {
      const result = await loadSkills(execution_env, source, BACKGROUND_CONTEXT);
      for (const diagnostic of result.diagnostics) log_skill_diagnostic(log_manager, diagnostic);
      const invalid_paths = new Set(
        result.diagnostics
          .filter((diagnostic) => diagnostic.code === "invalid_metadata")
          .map((diagnostic) => diagnostic.path),
      );
      for (const skill of result.skills.toSorted((left, right) =>
        left.filePath.localeCompare(right.filePath),
      )) {
        if (
          invalid_paths.has(skill.filePath) ||
          path.basename(path.dirname(skill.filePath)) !== skill.name
        ) {
          continue;
        }
        if (skills.has(skill.name)) continue;
        skills.set(skill.name, create_agent_skill_definition(skill, log_manager, native_fs));
      }
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

/** 将 Pi 的协议结果收口为产品会话使用的 skill 定义，并在此补齐 UI 投影。 */
function create_agent_skill_definition(
  skill: Skill,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs,
): AgentSkillDefinition {
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath.replaceAll("\\", "/"),
    disableModelInvocation: skill.disableModelInvocation,
    content: skill.content,
    ...load_skill_ui(skill, log_manager, native_fs),
  };
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

/** 显式 marker 直接注入完整正文，不再附带 SDK 的第二套路由说明。 */
export function format_agent_skill_invocation(skill: AgentSkillInvocationDefinition): string {
  return `<skill name="${escape_agent_skill_xml(skill.name)}">\n${skill.content}\n</skill>`;
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

/** 缺失的可选 skill 资源不产生诊断，其它 IO 错误仍需显式暴露。 */
function is_not_found_error(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Pi 只负责 skill 协议解析，所有真实扫描与读取仍经过项目 NativeFs 门面。 */
class AgentSkillExecutionEnv extends NodeExecutionEnv {
  /** 注入应用文件门面，使第三方解析器不直接越过宿主 IO 边界。 */
  public constructor(
    options: { cwd: string },
    private readonly native_fs: AgentSkillNativeFs,
  ) {
    super(options);
  }

  /** 把 Pi 的文本读取协议适配为应用文件读取，并保留中止与错误语义。 */
  public override async readTextFile(
    file_path: string,
    context: Context,
  ): Promise<Result<string, FileError>> {
    const resolved_path = this.resolve_path(file_path);
    if (context.abortSignal?.aborted) {
      return err(new FileError("aborted", "aborted", resolved_path));
    }
    try {
      return ok(this.native_fs.read_text_file(resolved_path));
    } catch (error) {
      return err(to_file_error(error, resolved_path));
    }
  }

  /** 将应用文件状态投影成 Pi 识别的普通文件或目录。 */
  public override async fileInfo(
    file_path: string,
    context: Context,
  ): Promise<Result<FileInfo, FileError>> {
    const resolved_path = this.resolve_path(file_path);
    if (context.abortSignal?.aborted) {
      return err(new FileError("aborted", "aborted", resolved_path));
    }
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
      });
    } catch (error) {
      return err(to_file_error(error, resolved_path));
    }
  }

  /** 枚举 skill 目录时忽略符号链接，避免第三方扫描越过目录树。 */
  public override async listDir(
    directory: string,
    context: Context,
  ): Promise<Result<FileInfo[], FileError>> {
    const resolved_path = this.resolve_path(directory);
    if (context.abortSignal?.aborted) {
      return err(new FileError("aborted", "aborted", resolved_path));
    }
    try {
      const file_infos: FileInfo[] = [];
      for (const entry of this.native_fs.read_dirents(resolved_path)) {
        if (entry.isSymbolicLink()) continue;
        const result = await this.fileInfo(path.join(resolved_path, entry.name), context);
        if (!result.ok) return result;
        file_infos.push(result.value);
      }
      return ok(file_infos);
    } catch (error) {
      return err(to_file_error(error, resolved_path));
    }
  }

  /** 统一相对路径基准与分隔符，保持 Pi 返回路径在各平台一致。 */
  private resolve_path(file_path: string): string {
    return (path.isAbsolute(file_path) ? file_path : path.resolve(this.cwd, file_path)).replaceAll(
      "\\",
      "/",
    );
  }
}

/** 将宿主 IO 错误映射为 Pi 的窄错误码，同时保留原始 cause。 */
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
