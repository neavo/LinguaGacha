import { is_preparation_path, GameSourceConflictError } from "./source-file-paths";
import path from "node:path";
import type { NativeFs } from "../../native/native-fs";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatId,
} from "../../shared/project-source-formats";
import type { ProjectSourceFileEntry } from "./file-format-types";
import { GAME_ENGINES, type GameSource } from "./shared/game/engines";

export type SourceIdentity =
  | Readonly<{ kind: "file"; format: ProjectSourceFormatId | undefined }>
  | GameSource
  | Readonly<{ kind: "failure"; error: unknown }>;
export type DiscoveredSource = ProjectSourceFileEntry & Readonly<{ source: SourceIdentity }>;
const FORMATS = new Map<string, ProjectSourceFormatId>(
  PROJECT_SOURCE_FORMATS.filter((format) => format.source_kind === "file").map((format) => [
    format.extension,
    format.id,
  ]),
);

/** 显式选择检查候选祖先，递归扫描只检查当前目录，按保留名称停止下探。 */
function find_managed_directory(
  source: string,
  fs: NativeFs,
  signal: AbortSignal | undefined,
  ancestors: boolean,
): string | null {
  for (let candidate = path.resolve(source); ; candidate = path.dirname(candidate)) {
    signal?.throwIfAborted();
    if (is_preparation_path(path.basename(candidate))) {
      let directory = false;
      try {
        directory = fs.stat(candidate).isDirectory();
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        // 不存在的候选交给正常来源检查报告。
      }
      if (directory) return candidate;
    }
    if (!ancestors || path.dirname(candidate) === candidate) return null;
  }
}

/** 显式入口的管理目录识别失败直接归集，不能降级为普通目录继续展开。 */
export async function discover_source(
  source_path: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<DiscoveredSource> {
  try {
    const managed = find_managed_directory(source_path, fs, signal, true);
    if (managed)
      throw new Error("Game management directory cannot be used as an import source: " + managed);
  } catch (error) {
    signal?.throwIfAborted();
    return {
      source_path,
      rel_path: path.basename(source_path),
      source: { kind: "failure", error },
    };
  }
  return read_source(source_path, fs, signal);
}

/** 仅来源编排边界归集失败；取消和相互冲突的游戏入口终止整批。 */
async function read_source(
  source_path: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<DiscoveredSource> {
  let rel_path = path.basename(source_path);
  try {
    signal?.throwIfAborted();
    if (!fs.exists(source_path))
      throw Object.assign(new Error("Source not found: " + source_path), { code: "ENOENT" });
    if (fs.stat(source_path).isDirectory()) rel_path += ".zip";
    for (const engine of Object.values(GAME_ENGINES)) {
      const source = await engine.discover(source_path, fs, signal);
      if (source)
        return {
          source_path: engine.source_path(source, source_path),
          rel_path: path.basename(source.game.root) + ".zip",
          file_type: source.file_type,
          source,
        };
    }
    return {
      source_path,
      rel_path,
      source: { kind: "file", format: FORMATS.get(path.extname(source_path).toLowerCase()) },
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof GameSourceConflictError) throw error;
    return { source_path, rel_path, source: { kind: "failure", error } };
  }
}

/** 同根身份冲突先于任何准备操作检查，所有批量入口共用。 */
export function assert_source_identities(entries: readonly DiscoveredSource[], fs: NativeFs): void {
  const roots = new Map<string, string>();
  for (const { source } of entries) {
    if (source.kind !== "game") continue;
    const root = fs.to_identity_path(source.game.root);
    const identity =
      source.file_type + ":" + fs.to_identity_path(GAME_ENGINES[source.file_type].identity(source));
    const previous = roots.get(root);
    if (previous && previous !== identity)
      throw new GameSourceConflictError("Conflicting game sources: " + source.game.root);
    roots.set(root, identity);
  }
}

/** 递归发现保留具体身份；单个坏来源不会阻断其他输入或目录中的兄弟来源。 */
export async function discover_sources(
  source_paths: readonly string[],
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<DiscoveredSource[]> {
  const entries: DiscoveredSource[] = [],
    visited = new Set<string>();
  /** 每个物理来源只探测一次，普通目录按稳定顺序展开。 */
  async function visit(source_path: string, source_root: string): Promise<void> {
    signal?.throwIfAborted();
    const explicit = source_path === source_root; // 显式输入须报告失败，递归遇到管理目录则跳过。
    try {
      const managed = find_managed_directory(source_path, fs, signal, explicit);
      if (managed) {
        if (!explicit) return;
        throw new Error("Game management directory cannot be used as an import source: " + managed);
      }
    } catch (error) {
      signal?.throwIfAborted();
      entries.push({
        source_path,
        rel_path: path.basename(source_path),
        source: { kind: "failure", error },
      });
      return;
    }
    const key = fs.to_identity_path(source_path);
    if (visited.has(key)) return;
    visited.add(key);
    const entry = await read_source(source_path, fs, signal);
    try {
      const directory = fs.exists(source_path) && fs.stat(source_path).isDirectory();
      // 坏 EXE 所在的普通容器目录仍展开兄弟来源；有游戏标志的坏目录整体报告失败。
      const container =
        directory &&
        (entry.source.kind === "file" ||
          (entry.source.kind === "failure" &&
            !Object.values(GAME_ENGINES).some((engine) => engine.is_root(source_path, fs))));
      if (container) {
        for (const child of fs
          .read_dirents(source_path)
          .sort((a, b) => a.name.localeCompare(b.name)))
          if (child.isDirectory() || child.isFile())
            await visit(path.join(source_path, child.name), source_root);
        return;
      }
      if (entry.source.kind === "file") {
        if (!entry.source.format) return;
        entry.rel_path = fs.stat(source_root).isDirectory()
          ? path.relative(path.dirname(source_root), source_path)
          : path.basename(source_path);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof GameSourceConflictError) throw error;
      entries.push(
        entry.source.kind === "failure" ? entry : { ...entry, source: { kind: "failure", error } },
      );
      return;
    }
    entries.push(entry);
  }
  for (const source of source_paths) if (source.trim()) await visit(source, source);
  assert_source_identities(entries, fs);
  const roots = entries.flatMap(({ source }) =>
    source.kind === "game" ? [fs.to_identity_path(source.game.root)] : [],
  );
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const source = entry.source;
    const key = fs.to_identity_path(source.kind === "game" ? source.game.root : entry.source_path);
    const identity = (source.kind === "failure" ? "failure:" : "source:") + key;
    if (seen.has(identity)) return false;
    if (source.kind === "file" && roots.some((root) => key.startsWith(root + path.sep)))
      return false;
    seen.add(identity);
    return true;
  });
}
