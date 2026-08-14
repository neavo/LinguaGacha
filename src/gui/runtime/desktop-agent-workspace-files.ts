import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { is_json_record } from "../../domain/json";
import {
  AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES,
  AGENT_WORKSPACE_TASK_ROOT,
} from "../../shared/backend-runtime";
import {
  compile_literal_patterns,
  type LiteralPattern,
  type TextRange,
} from "../../shared/text/literal-matcher";
import { iterate_utf8_lf_lines } from "../../shared/utils/text-tool";

/** Electron main 只解析建立文件权限和正式匹配入口所需的 contract 子集。 */
type WorkspaceContract = {
  changes?: Record<string, Record<string, { path?: unknown }>>; // Backend 声明的固定 change 文件
  recipes?: Record<string, { path?: unknown }>; // Backend 声明的发布 recipe
  datasets?: { items?: { path?: unknown } }; // 正式字面匹配只扫描固定 items 快照
};

/** renderer 私有协议完成校验后的正式匹配参数。 */
type LiteralMatchRequest = {
  patterns: LiteralPattern[];
  examples_per_pattern: number;
};

/** 单个 pattern 的 item、字段与有限证据聚合。 */
type LiteralMatchPatternResult = {
  key: string;
  matched_item_count: number;
  field_item_counts: { src: number; name_src: number };
  example_matches: Array<{
    item_id: number;
    field: "src" | "name_src";
    ranges: TextRange[];
  }>;
};

/** 单次完整 items 扫描的公开匹配结果。 */
type LiteralMatchResult = {
  scanned_item_count: number;
  matched_item_count: number;
  patterns: LiteralMatchPatternResult[];
};

type CommitRecord = {
  root: string; // 本次替换的最上层非重叠相对路径
  hadBase: boolean; // 原基线是否已经移动到 backup
  installed: boolean; // upper 是否已经安装到基线
};

/** 私有 protocol 的单层目录条目；大小只属于普通文件。 */
type WorkspaceListEntry = {
  type: "directory" | "file"; // 合并视图中的真实路径类型
  size_bytes?: number; // 只有普通文件携带字节数
};

/** 只有显式协议校验错误可以把 message 返回给沙箱脚本。 */
class WorkspaceProtocolError extends Error {}

/** 工作区本体或契约已经不可信，调用方必须销毁活动工作区。 */
export class AgentWorkspaceInvalidError extends Error {}

/** 文件提交失败会标明补偿是否完整，避免调用方猜测基线状态。 */
export class AgentWorkspaceTransactionError extends Error {
  /** workspacePreserved 是调用方决定保留或销毁工作区的唯一依据。 */
  public constructor(
    message: string,
    public readonly workspacePreserved: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

/**
 * 单次沙箱执行的磁盘事务视图。所有写入先落 upper，成功结果产生后才替换基线。
 */
export class DesktopAgentWorkspaceFiles {
  private readonly change_paths: ReadonlySet<string>; // open 时冻结的固定 change 文件白名单
  private readonly recipes: ReadonlyMap<string, string>; // open 时冻结的只读 recipe 路径
  private readonly items_path: string; // open 时冻结的完整 items 数据集路径
  private readonly source_path: string; // Backend 在活动 UUID 旁维护的工程源文件纯文本投影
  private readonly task_path: string; // Backend 在活动 UUID 旁维护的跨快照自由任务目录
  private readonly upper_path: string; // 脚本本次写入形成的覆盖层
  private readonly backup_path: string; // 提交过程中暂存的原基线
  private readonly written_paths = new Set<string>(); // upper 中完成原子写入的文件
  private readonly tombstones = new Set<string>(); // 当前合并视图隐藏的 scratch 或 task 路径
  private host_failure: AgentWorkspaceInvalidError | null = null; // 可信快照损坏不能伪装成模型脚本请求错误
  private finalized = false; // commit / rollback 只允许第一次改变事务状态

  /** 只允许 open 在验证根目录和 contract 后构造冻结权限视图。 */
  private constructor(
    private readonly workspace_path: string,
    contract: WorkspaceContract,
    private readonly transaction_path: string,
  ) {
    this.change_paths = new Set(
      Object.values(contract.changes ?? {}).flatMap((operations) =>
        Object.values(operations).flatMap((operation) =>
          typeof operation.path === "string" ? [normalize_workspace_path(operation.path)] : [],
        ),
      ),
    );
    this.recipes = new Map(
      Object.entries(contract.recipes ?? {}).map(([name, recipe]) => {
        if (typeof recipe.path !== "string") {
          throw new AgentWorkspaceInvalidError("Workspace recipe contract is invalid.");
        }
        const recipe_path = normalize_workspace_path(recipe.path);
        if (!recipe_path.startsWith("recipes/")) {
          throw new AgentWorkspaceInvalidError("Workspace recipe contract is invalid.");
        }
        return [name, recipe_path] as const;
      }),
    );
    const items_path = contract.datasets?.items?.path;
    if (typeof items_path !== "string") {
      throw new AgentWorkspaceInvalidError("Workspace items contract is invalid.");
    }
    this.items_path = normalize_workspace_path(items_path);
    this.source_path = path.join(path.dirname(workspace_path), "sources");
    this.task_path = path.join(path.dirname(workspace_path), AGENT_WORKSPACE_TASK_ROOT);
    this.upper_path = path.join(transaction_path, "upper");
    this.backup_path = path.join(transaction_path, "backup");
  }

  /** 打开时缓存 contract 白名单；脚本不能通过改写 contract 扩大当前运行权限。 */
  public static async open(workspace_path: string): Promise<DesktopAgentWorkspaceFiles> {
    const root = path.resolve(workspace_path);
    try {
      const root_stat = await fs.promises.lstat(root);
      if (!root_stat.isDirectory() || root_stat.isSymbolicLink()) {
        throw new AgentWorkspaceInvalidError("Agent workspace directory is invalid.");
      }
      await assert_regular_directory(path.join(path.dirname(root), AGENT_WORKSPACE_TASK_ROOT));
      await assert_path_has_no_symlink(root, "contract.json");
      const contract_text = await fs.promises.readFile(path.join(root, "contract.json"), "utf-8");
      const contract = read_workspace_contract(JSON.parse(contract_text));
      const transaction_path = path.join(root, ".transactions", randomUUID());
      const files = new DesktopAgentWorkspaceFiles(root, contract, transaction_path);
      await assert_path_has_no_symlink(root, ".transactions");
      await Promise.all([
        fs.promises.mkdir(path.join(transaction_path, "upper"), { recursive: true }),
        fs.promises.mkdir(path.join(transaction_path, "backup"), { recursive: true }),
      ]);
      return files;
    } catch (error) {
      if (error instanceof AgentWorkspaceInvalidError) throw error;
      throw new AgentWorkspaceInvalidError("Agent workspace or contract.json is invalid.", {
        cause: error,
      });
    }
  }

  /** 一次读取 contract 声明的全部 recipe，且脚本文件始终按基线只读。 */
  public async read_recipe_sources(): Promise<Record<string, string>> {
    const sources: Record<string, string> = {};
    for (const [name, recipe_path] of this.recipes) {
      await assert_path_has_no_symlink(this.workspace_path, recipe_path);
      const source_path = resolve_workspace_path(this.workspace_path, recipe_path);
      const stat = await fs.promises.lstat(source_path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new AgentWorkspaceInvalidError("Workspace recipe file is invalid.");
      }
      sources[name] = await fs.promises.readFile(source_path, "utf-8");
    }
    return sources;
  }

  /** protocol 的所有文件请求都经过当前事务合并视图。 */
  public async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== "workspace") return response_text(404, "未知工作区。");
    try {
      if (url.pathname.startsWith("/files/")) {
        const relative_path = decode_protocol_path(url.pathname.slice("/files/".length));
        if (request.method === "GET") return await this.read_file(relative_path);
        if (request.method === "PUT") return await this.write_file(relative_path, request);
        if (request.method === "DELETE") return await this.remove_file(relative_path);
      }
      if (url.pathname === "/__list__" && request.method === "GET") {
        return await this.list(url.searchParams.get("path") ?? "");
      }
      if (url.pathname === "/__match_literals__" && request.method === "POST") {
        return Response.json(
          await this.match_literals(read_literal_match_request(await request.json())),
        );
      }
    } catch (error) {
      if (error instanceof AgentWorkspaceInvalidError) this.host_failure ??= error;
      return response_text(400, project_protocol_error(error));
    }
    return response_text(405, "Unsupported workspace operation.");
  }

  /** 成功结果产生后才把非重叠变更根替换进基线，失败则反向恢复备份。 */
  public async commit(signal?: AbortSignal): Promise<void> {
    if (this.finalized) return;
    signal?.throwIfAborted();
    const upper_path = this.upper_path;
    const backup_path = this.backup_path;
    const roots = collapse_roots([...this.tombstones, ...this.written_paths]);
    const records: CommitRecord[] = [];
    try {
      for (const root of roots) {
        // scratch 与 task 允许任意子路径，提交前必须再次验证对应基线没有被替换为符号链接。
        const baseline = resolve_workspace_baseline(this.workspace_path, this.task_path, root);
        await assert_regular_directory(baseline.root);
        await assert_path_has_no_symlink(baseline.root, baseline.relativePath);
        const record: CommitRecord = { root, hadBase: false, installed: false };
        records.push(record);
        const base_target = baseline.target;
        const backup_target = resolve_workspace_path(backup_path, root);
        const upper_target = resolve_workspace_path(upper_path, root);
        if (await path_exists(base_target)) {
          await fs.promises.mkdir(path.dirname(backup_target), { recursive: true });
          await fs.promises.rename(base_target, backup_target);
          record.hadBase = true;
          signal?.throwIfAborted();
        }
        if (await path_exists(upper_target)) {
          await fs.promises.mkdir(path.dirname(base_target), { recursive: true });
          await fs.promises.rename(upper_target, base_target);
          record.installed = true;
          signal?.throwIfAborted();
        }
      }
      signal?.throwIfAborted();
    } catch (error) {
      const restored = await restore_commit(
        this.workspace_path,
        this.task_path,
        backup_path,
        records,
      );
      this.finalized = true;
      let cleaned = true;
      try {
        await this.cleanup_transaction();
      } catch {
        cleaned = false;
      }
      const preserved = restored && cleaned;
      throw new AgentWorkspaceTransactionError(
        preserved
          ? "Workspace file transaction commit failed; changes were rolled back."
          : "Workspace file transaction compensation failed.",
        preserved,
        error,
      );
    }
    this.finalized = true;
    try {
      await this.cleanup_transaction();
    } catch (error) {
      throw new AgentWorkspaceTransactionError(
        "Workspace transaction cleanup failed.",
        false,
        error,
      );
    }
  }

  /** runner 在提交前读取协议内部失败，脚本即使捕获 fetch 异常也不能掩盖宿主故障。 */
  public get_host_failure(): AgentWorkspaceInvalidError | null {
    return this.host_failure;
  }

  /** 未提交执行只删除当前 upper；删除失败时不能再声称基线可安全复用。 */
  public async rollback(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    try {
      await this.cleanup_transaction();
    } catch (error) {
      throw new AgentWorkspaceTransactionError(
        "Workspace transaction rollback failed.",
        false,
        error,
      );
    }
  }

  /** 读取优先命中 upper，再应用删除标记，最后回落到只读基线。 */
  private async read_file(relative_path: string): Promise<Response> {
    const normalized = normalize_workspace_path(relative_path);
    if (normalized.startsWith("sources/")) {
      const source_relative_path = normalized.slice("sources/".length);
      await assert_path_has_no_symlink(this.source_path, source_relative_path);
      return await read_regular_file(
        resolve_workspace_path(this.source_path, source_relative_path),
      );
    }
    const upper_file = await this.find_upper_path(normalized);
    if (upper_file !== null) return await read_regular_file(upper_file);
    if (this.is_tombstoned(normalized)) return response_text(404, "工作区文件不存在。");
    const baseline = resolve_workspace_baseline(this.workspace_path, this.task_path, normalized);
    await assert_regular_directory(baseline.root);
    await assert_path_has_no_symlink(baseline.root, baseline.relativePath);
    return await read_regular_file(baseline.target);
  }

  /** 写入只落到 upper，固定 change 文件必须由 contract 声明。 */
  private async write_file(relative_path: string, request: Request): Promise<Response> {
    const normalized = normalize_workspace_path(relative_path);
    const fixed_change = this.change_paths.has(normalized);
    const writable =
      fixed_change || is_workspace_scratch_entry(normalized) || is_workspace_task_entry(normalized);
    if (!writable) {
      return response_text(403, "该工作区文件只读。");
    }
    if (request.body === null) throw new WorkspaceProtocolError("Workspace write body is missing.");
    if (fixed_change) {
      await assert_path_has_no_symlink(this.workspace_path, normalized);
      const stat = await fs.promises.lstat(resolve_workspace_path(this.workspace_path, normalized));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new WorkspaceProtocolError("Target is not a regular workspace file.");
      }
    } else if (is_workspace_task_entry(normalized)) {
      const baseline = resolve_workspace_baseline(this.workspace_path, this.task_path, normalized);
      await assert_regular_directory(baseline.root);
      await assert_path_has_no_symlink(baseline.root, baseline.relativePath);
    }
    const upper_path = this.upper_path;
    const file_path = resolve_workspace_path(upper_path, normalized);
    await assert_path_has_no_symlink(upper_path, normalized);
    await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
    const temp_path = path.join(
      path.dirname(file_path),
      `.${path.basename(file_path)}.${randomUUID()}.tmp`,
    );
    try {
      await pipeline(
        Readable.fromWeb(
          request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
        ),
        fs.createWriteStream(temp_path, { flags: "wx" }),
      );
      await fs.promises.rename(temp_path, file_path);
      this.written_paths.add(normalized);
      return new Response(null, { status: 204 });
    } finally {
      await fs.promises.rm(temp_path, { force: true });
    }
  }

  /** 删除只允许 snapshot scratch 或 task 内容，并以 tombstone 遮蔽仍存在的基线。 */
  private async remove_file(relative_path: string): Promise<Response> {
    const normalized = normalize_workspace_path(relative_path);
    if (!is_workspace_scratch_root_or_entry(normalized) && !is_workspace_task_entry(normalized)) {
      return response_text(403, "只能删除 scratch 或 task 内容。");
    }
    const upper_path = this.upper_path;
    await fs.promises.rm(resolve_workspace_path(upper_path, normalized), {
      recursive: true,
      force: true,
    });
    for (const written of this.written_paths) {
      if (written === normalized || written.startsWith(`${normalized}/`)) {
        this.written_paths.delete(written);
      }
    }
    this.tombstones.add(normalized);
    return new Response(null, { status: 204 });
  }

  /** 目录列表合并基线与 upper，并排除 tombstone 和事务实现目录。 */
  private async list(relative_path: string): Promise<Response> {
    const normalized = normalize_workspace_path(relative_path, true);
    const entries = new Map<string, WorkspaceListEntry>();
    // null 表示普通 snapshot 事务视图，字符串表示同级挂载内的相对目录。
    const source_relative_path = mounted_relative_path(normalized, "sources");
    const task_relative_path = mounted_relative_path(normalized, AGENT_WORKSPACE_TASK_ROOT);
    if (source_relative_path !== null) {
      await add_directory_entries(this.source_path, source_relative_path, entries, () => false);
    } else if (task_relative_path !== null) {
      await assert_regular_directory(this.task_path);
      if (!this.is_tombstoned(normalized)) {
        await add_directory_entries(this.task_path, task_relative_path, entries, (child) =>
          this.is_tombstoned(`${AGENT_WORKSPACE_TASK_ROOT}/${child}`),
        );
      }
    } else if (!this.is_tombstoned(normalized)) {
      await add_directory_entries(this.workspace_path, normalized, entries, (child) =>
        this.is_tombstoned(child),
      );
      if (normalized === "" && (await path_exists(this.source_path))) {
        entries.set("sources", { type: "directory" });
      }
      if (normalized === "" && (await path_exists(this.task_path))) {
        entries.set(AGENT_WORKSPACE_TASK_ROOT, { type: "directory" });
      }
    }
    if (source_relative_path === null) {
      await add_directory_entries(this.upper_path, normalized, entries, () => false);
    }
    if (normalized === "") entries.delete(".transactions");
    return Response.json(
      [...entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, entry]) => ({ name, ...entry })),
    );
  }

  /** 返回 upper 中已覆盖的普通路径。 */
  private async find_upper_path(relative_path: string): Promise<string | null> {
    await assert_path_has_no_symlink(this.upper_path, relative_path);
    const candidate = resolve_workspace_path(this.upper_path, relative_path);
    return (await path_exists(candidate)) ? candidate : null;
  }

  /** 父目录删除会同时遮蔽所有后代。 */
  private is_tombstoned(relative_path: string): boolean {
    for (const removed of this.tombstones) {
      if (relative_path === removed || relative_path.startsWith(`${removed}/`)) return true;
    }
    return false;
  }

  /** 清理只针对本次 UUID 目录，不触碰其它并发或崩溃遗留事务。 */
  private async cleanup_transaction(): Promise<void> {
    await fs.promises.rm(this.transaction_path, { recursive: true, force: true });
  }

  /** 正式匹配器只读基线 items，一次编译并按自然行序扫描一次。 */
  private async match_literals(request: LiteralMatchRequest): Promise<LiteralMatchResult> {
    await assert_path_has_no_symlink(this.workspace_path, this.items_path);
    const items_file = resolve_workspace_path(this.workspace_path, this.items_path);
    const matcher = compile_literal_patterns(request.patterns);
    // Map 同时保持输入 pattern 顺序，并作为 matcher key 的完整结果索引。
    const results = new Map<string, LiteralMatchPatternResult>(
      request.patterns.map((pattern) => [
        pattern.key,
        {
          key: pattern.key,
          matched_item_count: 0,
          field_item_counts: { src: 0, name_src: 0 },
          example_matches: [],
        },
      ]),
    );
    let scanned_item_count = 0;
    let matched_item_count = 0;
    for await (const line of iterate_utf8_lf_lines(fs.createReadStream(items_file))) {
      if (line.trim() === "") continue;
      let item: unknown;
      try {
        item = JSON.parse(line) as unknown;
      } catch (cause) {
        throw new AgentWorkspaceInvalidError("Workspace items dataset is invalid.", { cause });
      }
      if (!is_json_record(item)) {
        throw new AgentWorkspaceInvalidError("Workspace items dataset is invalid.");
      }
      const item_id = item["item_id"];
      const src = item["src"];
      const name_src = item["name_src"];
      if (
        typeof item_id !== "number" ||
        !Number.isInteger(item_id) ||
        item_id < 1 ||
        typeof src !== "string" ||
        typeof name_src !== "string"
      ) {
        throw new AgentWorkspaceInvalidError("Workspace items dataset is invalid.");
      }
      scanned_item_count += 1;
      // 同一 pattern 可命中两个字段，但本 item 的 pattern 计数只增加一次。
      const matched_keys = new Set<string>();
      for (const [field, text] of [
        ["src", src],
        ["name_src", name_src],
      ] as const) {
        for (const match of matcher.match(text)) {
          const result = results.get(match.key)!;
          result.field_item_counts[field] += 1;
          matched_keys.add(match.key);
          if (result.example_matches.length < request.examples_per_pattern) {
            result.example_matches.push({ item_id, field, ranges: match.ranges });
          }
        }
      }
      if (matched_keys.size > 0) matched_item_count += 1;
      for (const key of matched_keys) {
        results.get(key)!.matched_item_count += 1;
      }
    }
    return {
      scanned_item_count,
      matched_item_count,
      patterns: [...results.values()],
    };
  }
}

/** 只读取宿主授权所需的 contract 区块。 */
function read_workspace_contract(value: unknown): WorkspaceContract {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentWorkspaceInvalidError("Workspace contract.json root is invalid.");
  }
  const contract = value as WorkspaceContract;
  for (const section of [contract.changes, contract.recipes, contract.datasets]) {
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      throw new AgentWorkspaceInvalidError("Workspace contract.json structure is invalid.");
    }
  }
  return contract;
}

/** 私有匹配协议在进入文件扫描前收窄输入，避免脚本绕过公开包装扩大证据输出。 */
function read_literal_match_request(value: unknown): LiteralMatchRequest {
  if (!is_json_record(value)) {
    throw new WorkspaceProtocolError("Literal match arguments must be an object.");
  }
  if (!Array.isArray(value["patterns"])) {
    throw new WorkspaceProtocolError("Literal match patterns must be an array.");
  }
  const keys = new Set<string>();
  const patterns = value["patterns"].map((value): LiteralPattern => {
    if (!is_json_record(value)) {
      throw new WorkspaceProtocolError("Each literal match pattern must be an object.");
    }
    if (typeof value["key"] !== "string" || value["key"] === "") {
      throw new WorkspaceProtocolError("Literal match pattern key must be a non-empty string.");
    }
    if (keys.has(value["key"])) {
      throw new WorkspaceProtocolError("Literal match pattern keys must be unique.");
    }
    keys.add(value["key"]);
    if (typeof value["text"] !== "string" || value["text"] === "") {
      throw new WorkspaceProtocolError("Literal match pattern text must be a non-empty string.");
    }
    if (typeof value["case_sensitive"] !== "boolean") {
      throw new WorkspaceProtocolError("Literal match pattern case_sensitive must be boolean.");
    }
    return {
      key: value["key"],
      text: value["text"],
      case_sensitive: value["case_sensitive"],
    };
  });
  const examples = value["examples_per_pattern"];
  if (
    typeof examples !== "number" ||
    !Number.isInteger(examples) ||
    examples < 0 ||
    examples > AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES
  ) {
    throw new WorkspaceProtocolError(
      `Literal match examples_per_pattern must be an integer from 0 to ${AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES}.`,
    );
  }
  return { patterns, examples_per_pattern: examples };
}

/** 路径只接受正斜线相对路径，并拒绝访问宿主事务实现目录。 */
function resolve_workspace_path(workspace_path: string, relative_path: string): string {
  const normalized = normalize_workspace_path(relative_path, true);
  const root = path.resolve(workspace_path);
  const target = path.resolve(root, ...normalized.split("/").filter(Boolean));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new WorkspaceProtocolError("Workspace path escapes the workspace root.");
  }
  return target;
}

/** 把虚拟 task 路径映射到对话级任务目录，其它路径仍属于当前 snapshot。 */
function resolve_workspace_baseline(
  workspace_path: string,
  task_path: string,
  relative_path: string,
): { root: string; relativePath: string; target: string } {
  const task_relative_path = mounted_relative_path(relative_path, AGENT_WORKSPACE_TASK_ROOT);
  const root = task_relative_path === null ? workspace_path : task_path;
  const normalized = task_relative_path === null ? relative_path : task_relative_path;
  return {
    root,
    relativePath: normalized,
    target: resolve_workspace_path(root, normalized),
  };
}

/** 返回挂载内相对路径；null 表示目标不属于该挂载。 */
function mounted_relative_path(relative_path: string, mount: string): string | null {
  if (relative_path === mount) return "";
  return relative_path.startsWith(`${mount}/`) ? relative_path.slice(mount.length + 1) : null;
}

/** 统一为正斜线相对路径，并拒绝所有绝对、回退和事务实现路径。 */
function normalize_workspace_path(relative_path: string, allow_empty = false): string {
  if (
    relative_path.includes("\\") ||
    relative_path.includes("\0") ||
    path.posix.isAbsolute(relative_path) ||
    path.win32.isAbsolute(relative_path)
  ) {
    throw new WorkspaceProtocolError("Workspace path is invalid.");
  }
  const parts = relative_path.split("/").filter((part) => part !== "");
  if ((!allow_empty && parts.length === 0) || parts.includes(".") || parts.includes("..")) {
    throw new WorkspaceProtocolError("Workspace path is invalid.");
  }
  if (parts[0] === ".transactions") {
    throw new WorkspaceProtocolError("Workspace transaction directory is not accessible.");
  }
  return parts.join("/");
}

/** URL 路径只解码一次，非法转义由协议边界直接拒绝。 */
function decode_protocol_path(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new WorkspaceProtocolError("Workspace path encoding is invalid.");
  }
}

/** scratch 根目录本身不能作为文件覆盖，只有其后代可写。 */
function is_workspace_scratch_entry(relative_path: string): boolean {
  return relative_path.startsWith("scratch/");
}

/** task 根由宿主管理，模型可以自由写入和删除其中任意内容。 */
function is_workspace_task_entry(relative_path: string): boolean {
  return relative_path.startsWith(`${AGENT_WORKSPACE_TASK_ROOT}/`);
}

/** 删除允许指向 scratch 整体或任一后代。 */
function is_workspace_scratch_root_or_entry(relative_path: string): boolean {
  return relative_path === "scratch" || relative_path.startsWith("scratch/");
}

/** 以流式响应读取普通文件，避免把大数据集整体复制进内存。 */
async function read_regular_file(file_path: string): Promise<Response> {
  const stat = await fs.promises.lstat(file_path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new WorkspaceProtocolError("Target is not a regular workspace file.");
  }
  const body = Readable.toWeb(fs.createReadStream(file_path)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers: { "content-type": "application/octet-stream" } });
}

/** 把单层目录内容合并到结果；符号链接从可见视图中排除。 */
async function add_directory_entries(
  root: string,
  relative_path: string,
  target: Map<string, WorkspaceListEntry>,
  excluded: (child: string) => boolean,
): Promise<void> {
  const directory = resolve_workspace_path(root, relative_path);
  await assert_path_has_no_symlink(root, relative_path);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const child = relative_path === "" ? entry.name : `${relative_path}/${entry.name}`;
    if (excluded(child) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      target.set(entry.name, { type: "directory" });
      continue;
    }
    const stat = await fs.promises.lstat(path.join(directory, entry.name));
    if (stat.isFile() && !stat.isSymbolicLink()) {
      target.set(entry.name, { type: "file", size_bytes: stat.size });
    }
  }
}

/** 从受信任根逐段 lstat，拒绝现存路径中的任意符号链接。 */
async function assert_path_has_no_symlink(root_path: string, relative_path: string): Promise<void> {
  let current = path.resolve(root_path);
  for (const part of relative_path.split("/").filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.promises.lstat(current)).isSymbolicLink()) {
        throw new WorkspaceProtocolError("Workspace path must not contain symbolic links.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/** 同级挂载根也必须是普通目录，不能只验证其后代。 */
async function assert_regular_directory(root_path: string): Promise<void> {
  const stat = await fs.promises.lstat(root_path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new WorkspaceProtocolError("Workspace mount must be a regular directory.");
  }
}

/** 折叠被父目录覆盖的后代，避免同一提交重复移动嵌套路径。 */
function collapse_roots(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  );
  return sorted.filter(
    (candidate, index) =>
      !sorted
        .slice(0, index)
        .some((root) => candidate === root || candidate.startsWith(`${root}/`)),
  );
}

/** 按提交逆序恢复已安装路径；任一步失败都把工作区判为不可复用。 */
async function restore_commit(
  workspace_path: string,
  task_path: string,
  backup_path: string,
  records: CommitRecord[],
): Promise<boolean> {
  try {
    for (const record of [...records].reverse()) {
      const base_target = resolve_workspace_baseline(workspace_path, task_path, record.root).target;
      if (record.installed) {
        await fs.promises.rm(base_target, { recursive: true, force: true });
      }
      if (record.hadBase) {
        const backup_target = resolve_workspace_path(backup_path, record.root);
        await fs.promises.mkdir(path.dirname(base_target), { recursive: true });
        await fs.promises.rename(backup_target, base_target);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** 只把 ENOENT 视为不存在，其余文件系统错误保留原始上下文。 */
async function path_exists(file_path: string): Promise<boolean> {
  try {
    await fs.promises.lstat(file_path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 只投影可修复的工作区诊断，隐藏宿主文件系统细节。 */
function project_protocol_error(error: unknown): string {
  return error instanceof WorkspaceProtocolError
    ? error.message
    : "Workspace file operation failed.";
}

/** 协议错误统一使用 UTF-8 纯文本响应。 */
function response_text(status: number, text: string): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
