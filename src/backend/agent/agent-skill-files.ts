import { AGENT_SKILL_MAIN_FILE, AGENT_SKILL_UI_FILE } from "../../shared/agent-skills";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { default_native_fs as fs } from "../../native/native-fs";
import type {
  AgentSkillFile,
  AgentSkillFileChange,
  AgentSkillFileEntry,
  AgentSkillIdentity,
} from "../../shared/agent-skills";
import { AppError } from "../../shared/error";
import { read_agent_skill_document } from "./agent-skill-document";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** 相对路径协议及内部文件保护对所有文件操作一致。 */
function skill_path_parts(relative: string): string[] {
  const parts = relative.split("/");
  if (
    !relative ||
    relative.includes("\\") ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\0") ||
        part.toLowerCase() === AGENT_SKILL_UI_FILE,
    ) ||
    (relative.toLowerCase() === AGENT_SKILL_MAIN_FILE.toLowerCase() &&
      relative !== AGENT_SKILL_MAIN_FILE)
  ) {
    throw new AppError("request.validation_failed");
  }
  return parts;
}

/** 新名称使用可跨平台管理的文件名；已有条目按磁盘事实定位。 */
export function validate_skill_entry_name(name: string): void {
  if (
    !name ||
    /[\\/:<>"|?*]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    RESERVED_NAME.test(name)
  ) {
    throw new AppError("request.validation_failed");
  }
}

/** root 已由服务定位为真实技能包目录；包内链接与文件树采用相同的不跟随规则。 */
function read_skill_entry(root: string, parts: string[]): string {
  let cursor = root;
  for (const part of parts) {
    const requested = fs.to_identity_path(path.join(cursor, part));
    const entry = fs
      .read_dirents(cursor)
      .find((item) => fs.to_identity_path(path.join(cursor, item.name)) === requested);
    if (!entry || entry.isSymbolicLink()) throw new AppError("file.not_found");
    cursor = path.join(cursor, entry.name);
  }
  const target = fs.real_path(cursor);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new AppError("request.validation_failed");
  return target;
}

/** 定位磁盘中的现存条目，供读取和覆盖写入共用。 */
export function skill_existing_path(root: string, relative: string): string {
  return read_skill_entry(root, skill_path_parts(relative));
}

/** 新目标尚不存在，定位现存父目录后只校验末级名称。 */
function skill_target_path(root: string, relative: string): string {
  const parts = skill_path_parts(relative);
  const name = parts.at(-1)!;
  validate_skill_entry_name(name);
  return path.join(read_skill_entry(root, parts.slice(0, -1)), name);
}

/** 返回普通文件和目录，主文件置顶且内部资源隐藏。 */
export function read_skill_tree(root: string): AgentSkillFileEntry[] {
  const entries: AgentSkillFileEntry[] = [];
  /** 按父目录顺序展开后代，路径保持包内相对形式。 */
  function visit(directory: string, parent: string): void {
    for (const entry of fs
      .read_dirents(directory)
      .sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      )) {
      if (entry.name.toLowerCase() === AGENT_SKILL_UI_FILE || entry.isSymbolicLink()) continue;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const relative = parent ? `${parent}/${entry.name}` : entry.name;
      entries.push({ path: relative, kind: entry.isDirectory() ? "directory" : "file" });
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
    }
  }
  visit(root, "");
  return entries.sort(
    (a, b) => Number(b.path === AGENT_SKILL_MAIN_FILE) - Number(a.path === AGENT_SKILL_MAIN_FILE),
  );
}

/** 文本与版本来自同一批字节，无法无损编辑的文件只返回信息。 */
export function read_skill_file(
  root: string,
  skill: AgentSkillIdentity,
  relative: string,
): AgentSkillFile {
  const target = skill_existing_path(root, relative);
  const stat = fs.stat(target);
  if (!stat.isFile()) throw new AppError("request.validation_failed");
  if (stat.size > MAX_TEXT_BYTES)
    return { skill, path: relative, size: stat.size, revision: "", text: null };
  const bytes = fs.read_file(target);
  let text: string | null = null;
  try {
    if (!bytes.includes(0))
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    // 非 UTF-8 资源正常展示信息，避免有损解码后被保存覆盖。
  }
  return {
    skill,
    path: relative,
    size: stat.size,
    revision: createHash("sha256").update(bytes).digest("hex"),
    text,
    ...(relative === AGENT_SKILL_MAIN_FILE && text !== null
      ? { document: read_agent_skill_document(text, skill.name) }
      : {}),
  };
}

/** 同目录完整写入临时文件再替换；失败时清理临时文件并保留原始异常。 */
export function write_skill_file(target: string, text: string): void {
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new AppError("request.validation_failed");
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
  try {
    fs.write_file_sync(temporary, text);
    fs.rename(temporary, target);
  } catch (cause) {
    try {
      fs.remove(temporary, { force: true });
    } catch (cleanup) {
      throw new AggregateError([cause, cleanup], "Skill file write and cleanup failed.", { cause });
    }
    throw cause;
  }
}

/** 执行包内文件操作，根目录与主文件的生命周期由技能服务管理。 */
export function change_skill_file(root: string, change: AgentSkillFileChange): void {
  const creating = change.operation === "create_file" || change.operation === "create_directory";
  const target = creating
    ? skill_target_path(root, change.path)
    : skill_existing_path(root, change.path);
  if (change.path.toLowerCase() === AGENT_SKILL_MAIN_FILE.toLowerCase())
    throw new AppError("request.validation_failed");
  if (creating) {
    if (fs.exists(target)) throw new AppError("file.already_exists");
    if (change.operation === "create_file") fs.create_file_exclusive(target);
    else fs.make_dir(target);
    return;
  }
  // 递归操作不能通过父目录间接删除或移动隐藏资源。
  function assert_contents(directory: string): void {
    for (const entry of fs.read_dirents(directory)) {
      if (entry.name.toLowerCase() === AGENT_SKILL_UI_FILE || entry.isSymbolicLink())
        throw new AppError("request.validation_failed");
      if (entry.isDirectory()) assert_contents(path.join(directory, entry.name));
    }
  }
  if (fs.stat(target).isDirectory()) assert_contents(target);
  if (change.operation === "delete") {
    fs.remove(target, { recursive: true });
    return;
  }
  if (change.operation !== "move") throw new AppError("request.validation_failed");
  const destination = skill_target_path(root, change.destination);
  if (
    change.destination.toLowerCase() === AGENT_SKILL_MAIN_FILE.toLowerCase() ||
    change.destination.startsWith(`${change.path}/`)
  )
    throw new AppError("request.validation_failed");
  if (fs.exists(destination)) throw new AppError("file.already_exists");
  fs.rename(target, destination);
}
