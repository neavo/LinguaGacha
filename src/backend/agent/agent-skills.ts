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

import { default_native_fs, type NativeFs } from "../../native/native-fs";
import type { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";

const REFERENCES_DIR_NAME = "references";
const REFERENCE_EXTENSION = ".md";

export type AgentSkillReference = {
  path: string; // 相对 skill 根目录的 POSIX 路径，供正文解析相对引用
  filePath: string; // 规范化绝对路径，作为 read_skill 的运行期白名单 key
  content: string; // 启动期固定的完整正文，只在 read_skill 时下发
};

/** 保留 Pi skill 的完整调用语义，并附加启动期固定的受控 references。 */
export type AgentSkillDefinition = Skill & {
  references: AgentSkillReference[];
};

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
        references: load_skill_references(skill.filePath, log_manager, native_fs),
      });
    }
    return [...skills.values()];
  } catch (error) {
    log_manager.error("Agent skill 加载失败", { source: "agent", error });
    return [];
  }
}

/**
 * 递归读取 references 目录下的 Markdown 并形成进程内快照；符号链接与其它文件不进入白名单。
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
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      log_manager.warning("Agent skill references 目录读取失败", {
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
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(REFERENCE_EXTENSION)) continue;
    try {
      references.push({
        path: normalize_path(path.relative(skill_dir, entry_path)),
        filePath: normalize_path(entry_path),
        content: native_fs.read_text_file(entry_path),
      });
    } catch (error) {
      log_manager.warning(`Agent skill reference 读取失败：${entry.name}`, {
        source: "agent",
        context: { path: entry_path, error: String(error) },
      });
    }
  }
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
        return err(new FileError("invalid", "不支持的 skill 文件类型", resolved_path));
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
  log_manager.warning(diagnostic.message, {
    source: "agent",
    context: { code: diagnostic.code, path: diagnostic.path },
  });
}
