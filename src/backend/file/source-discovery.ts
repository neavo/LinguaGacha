import { GameSourceConflictError } from "./source-file-paths";
import path from "node:path";
import type { NativeFs } from "../../native/native-fs";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatId,
} from "../../shared/project-source-formats";
import type { ProjectSourceFileEntry } from "./file-format-types";
import {
  discover_rpgmaker_source,
  discover_unpacked_rpgmaker_source,
  type RPGMakerSource,
} from "./rpgmaker-mv-mz/source";
import { discover_rgss_source, type RGSSSource } from "./rpgmaker-rgss/source";

export type SourceIdentity =
  | Readonly<{ kind: "file"; format: ProjectSourceFormatId | undefined }>
  | Readonly<{ kind: "mv_mz"; game: RPGMakerSource }>
  | Readonly<{ kind: "rgss"; game: RGSSSource }>
  | Readonly<{ kind: "failure"; error: unknown }>;
export type DiscoveredSource = ProjectSourceFileEntry & Readonly<{ source: SourceIdentity }>;
const FORMATS = new Map<string, ProjectSourceFormatId>(
  PROJECT_SOURCE_FORMATS.filter((format) => format.source_kind === "file").map((format) => [
    format.extension,
    format.id,
  ]),
);

/** 仅来源编排边界归集失败；取消和相互冲突的游戏入口终止整批。 */
export async function discover_source(
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
    const mv = await discover_rpgmaker_source(source_path, fs, signal);
    if (mv)
      return {
        source_path: mv.executable ?? source_path,
        rel_path: path.basename(mv.root) + ".zip",
        file_type: "RPGMAKER_MV_MZ",
        source: { kind: "mv_mz", game: mv },
      };
    const rgss = discover_rgss_source(source_path, fs);
    if (rgss) {
      rel_path = path.basename(rgss.root) + ".zip";
      return {
        source_path: rgss.root,
        rel_path,
        file_type: "RPGMAKER_RGSS",
        source: { kind: "rgss", game: rgss },
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
    if (source.kind !== "mv_mz" && source.kind !== "rgss") continue;
    const root = fs.to_identity_path(source.game.root);
    const identity =
      source.kind +
      ":" +
      fs.to_identity_path(
        source.kind === "mv_mz"
          ? (source.game.executable ?? source.game.root)
          : path.join(source.game.root, source.game.archive ?? ""),
      );
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
    const key = fs.to_identity_path(source_path);
    if (visited.has(key)) return;
    visited.add(key);
    const entry = await discover_source(source_path, fs, signal);
    try {
      const directory = fs.exists(source_path) && fs.stat(source_path).isDirectory();
      // 坏 EXE 所在的普通容器目录仍展开兄弟来源；有游戏标志的坏目录整体报告失败。
      const container =
        directory &&
        (entry.source.kind === "file" ||
          (entry.source.kind === "failure" &&
            !discover_unpacked_rpgmaker_source(source_path, fs) &&
            !discover_rgss_source(source_path, fs)));
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
    source.kind === "mv_mz" || source.kind === "rgss"
      ? [fs.to_identity_path(source.game.root)]
      : [],
  );
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const source = entry.source;
    const key = fs.to_identity_path(
      source.kind === "mv_mz" || source.kind === "rgss" ? source.game.root : entry.source_path,
    );
    const identity = (source.kind === "failure" ? "failure:" : "source:") + key;
    if (seen.has(identity)) return false;
    if (source.kind === "file" && roots.some((root) => key.startsWith(root + path.sep)))
      return false;
    seen.add(identity);
    return true;
  });
}
