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
  type SkillDiagnostic,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import type { AgentSkillSnapshot } from "../../shared/agent";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import type { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";

const REFERENCES_DIR_NAME = "references";
const REFERENCE_EXTENSION = ".md";

export type AgentSkillReference = {
  file_name: string; // 仅文件名（不含目录），白名单读取的 key
  summary: string; // 首行非空文本，供模型判断是否需要加载正文
  content: string; // 完整正文，只在 read_skill_reference 时下发
};

/**
 * 技能渐进加载契约：system prompt 只注入 essentials + reference_index；
 * references 正文只由模型按需通过 read_skill_reference 拉取。
 */
export type AgentSkillDefinition = AgentSkillSnapshot & {
  essentials: string; // SKILL.md 正文（去掉 frontmatter）
  reference_index: string; // references 单层清单，无 references 时为空串
  references: AgentSkillReference[]; // 受控资源，read_skill_reference 白名单数据源
};

type AgentSkillLog = Pick<LogManager, "error" | "warning">;
type AgentSkillNativeFs = Pick<
  NativeFs,
  "read_dir_names" | "read_dirents" | "read_text_file" | "stat"
>;
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
      const references = load_skill_references(skill.filePath, log_manager, native_fs);
      const essentials = skill.content;
      const reference_index = build_reference_index(references);
      skills.set(skill.name, {
        name: skill.name,
        description: skill.description,
        essentials,
        reference_index,
        references,
      });
    }
    return [...skills.values()];
  } catch (error) {
    log_manager.error("Agent skill 加载失败", { source: "agent", error });
    return [];
  }
}

/**
 * 读取技能 references 目录单层 *.md，按文件名排序；目录不存在或读取失败降级为空清单，不阻断技能加载。
 */
function load_skill_references(
  skill_file_path: string,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs,
): AgentSkillReference[] {
  const references_dir = path.join(path.dirname(skill_file_path), REFERENCES_DIR_NAME);
  let entries: string[];
  try {
    entries = native_fs.read_dir_names(references_dir);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      log_manager.warning("Agent skill references 目录读取失败", {
        source: "agent",
        context: { path: references_dir, error: String(error) },
      });
    }
    return []; // 无 references 目录是正常情形
  }
  const file_names = entries
    .filter((name) => name.toLowerCase().endsWith(REFERENCE_EXTENSION))
    .sort((left, right) => left.localeCompare(right));
  const references: AgentSkillReference[] = [];
  for (const file_name of file_names) {
    try {
      const content = native_fs.read_text_file(path.join(references_dir, file_name));
      references.push({
        file_name,
        summary: read_first_non_empty_line(content),
        content,
      });
    } catch (error) {
      log_manager.warning(`Agent skill reference 读取失败：${file_name}`, {
        source: "agent",
        context: { path: path.join(references_dir, file_name), error: String(error) },
      });
    }
  }
  return references;
}

function build_reference_index(references: AgentSkillReference[]): string {
  if (references.length === 0) return "";
  const lines = references.map((reference) => `- ${reference.file_name}: ${reference.summary}`);
  return `## 参考资源（按需用 read_skill_reference 读取正文）\n${lines.join("\n")}`;
}

function read_first_non_empty_line(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed.replace(/^#+\s*/, "");
  }
  return "";
}

/**
 * pi-agent-core 0.82.1 的 skill walker 使用 POSIX 分隔符比较路径；适配器只复用它的协议解析，
 * 实际读取全部经过 NativeFs。符号链接不进入 skill 扫描，避免越过受控根或形成递归环。
 */
class AgentSkillExecutionEnv extends NodeExecutionEnv {
  public constructor(
    options: { cwd: string },
    private readonly native_fs: AgentSkillNativeFs,
  ) {
    super(options);
  }

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

  private resolve_path(file_path: string): string {
    return normalize_path(
      path.isAbsolute(file_path) ? file_path : path.resolve(this.cwd, file_path),
    );
  }
}

function normalize_path(file_path: string): string {
  return file_path.replaceAll("\\", "/");
}

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

function log_skill_diagnostic(log_manager: AgentSkillLog, diagnostic: SkillDiagnostic): void {
  log_manager.warning(diagnostic.message, {
    source: "agent",
    context: { code: diagnostic.code, path: diagnostic.path },
  });
}
