import { write_game_backup } from "./backup";
import {
  validate_game_path,
  assert_game_path_spellings,
  is_preparation_path,
} from "../../source-file-paths";
import type { GameFileType } from "../../../../shared/project-source-formats";
import path from "node:path";
import JSZip from "jszip";
import type { NativeFs } from "../../../../native/native-fs";
import type { Item } from "../../../../domain/item";
import { AppError } from "../../../../shared/error";
import type {
  FileFormatServiceWriteContext,
  SourceFileParseWarning,
  ProjectSourceFileEntry,
} from "../../file-format-types";
import { assert_source_file_paths, source_file_output_path } from "../../source-file-paths";
import { read_zip_members } from "../zip-members";

/** 容器根目录的游戏文件清单，供 Agent 核对资源引用。引擎白名单不会在根目录选出 `.txt`，因此不与原稿冲突。 */
export const GAME_FILES_MEMBER = "game_files.txt";

export type GameFiles = ReadonlyMap<string, JSZip.JSZipObject>;
/** 原稿成员与游戏文件清单分开返回，解析和导出只接触原稿成员。 */
export type GameContainer = Readonly<{
  members: GameFiles;
  game_files: JSZip.JSZipObject | null; // 早于清单的容器没有该成员。
}>;

/** 游戏 固化容器必须包含原稿文件，空容器不能作为游戏原稿。 */
export async function read_game_container(
  content: Uint8Array,
  file: string,
): Promise<GameContainer> {
  const members = new Map(await read_zip_members(content, file));
  const game_files = members.get(GAME_FILES_MEMBER) ?? null;
  members.delete(GAME_FILES_MEMBER);
  if (members.size === 0)
    throw new AppError("file.invalid_structure", { public_details: { file } });
  return { members, game_files };
}

/** 格式提供成员解析与写回，公共流程持有原稿清单和目录 IO。 */
export interface GameFormatAdapter {
  file_type: GameFileType;
  internal_path(item: Item): string;
  create_members(files: GameFiles): Promise<GameMemberHandler>;
}
/** 本次容器操作独享解析上下文，成员只接收自身内容。 */
export interface GameMemberHandler {
  read_file(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }>;
  render(content: Uint8Array, file: string, items: readonly Item[]): Promise<Uint8Array>;
}
/** 游戏原稿清单拥有导入、离线重建与目录导出，格式仅解释成员内容。 */
export class GameFormat {
  /** 每个处理器固定其格式适配器和文件入口。 */
  public constructor(
    private readonly adapter: GameFormatAdapter,
    private readonly fs: NativeFs,
  ) {}
  /** 完整读取并生成容器后备份同一批字节，备份成功才返回。 */
  public async prepare_source(
    entries: readonly Pick<ProjectSourceFileEntry, "source_path" | "rel_path">[],
    file: string,
    root: string,
    signal?: AbortSignal,
  ): Promise<{ content: Uint8Array; warnings: SourceFileParseWarning[] }> {
    signal?.throwIfAborted();
    const files = new Map<string, Uint8Array>(); // 同一次读取供容器和本次备份使用。
    assert_game_path_spellings(entries.map((entry) => entry.rel_path));
    const zip = new JSZip();
    const paths = new Set<string>();
    for (const entry of entries) {
      signal?.throwIfAborted();
      const internal = entry.rel_path;
      validate_game_path(internal);
      const key = internal.toLowerCase();
      if (paths.has(key) || key === GAME_FILES_MEMBER)
        throw new AppError("file.invalid_structure", { public_details: { file } });
      paths.add(key);
      const bytes = this.fs.read_file(entry.source_path);
      zip.file(internal, bytes, { createFolders: false });
      files.set(internal, bytes);
    }
    if (Object.keys(zip.files).length === 0)
      throw new AppError("file.parse_failed", { public_details: { file } });
    // 准备流程已解包归档并解密媒体，此时的目录即游戏运行时可见的文件集合。
    zip.file(GAME_FILES_MEMBER, list_game_files(root, this.fs, signal));
    // 资产存储层统一使用 Zstd 压缩，容器只保存结构和字节，避免重复压缩。
    const content = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    signal?.throwIfAborted();
    await write_game_backup(root, files, this.fs, signal);
    return { content, warnings: [] };
  }

  /** 首次导入与离线重建共用容器解析，行号在外层资产内连续。 */
  public async read_from_stream(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }> {
    const { members: files } = await read_game_container(content, file);
    const handler = await this.adapter.create_members(files);
    const items: Item[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const [name, member] of files) {
      try {
        const parsed = await handler.read_file(await member.async("uint8array"), name);
        warnings.push(
          ...parsed.warnings.map((warning) => ({
            ...warning,
            rel_path: file,
            internal_file_path: name,
          })),
        );
        for (const item of parsed.items)
          items.push({ ...item, file_path: file, row: items.length });
      } catch (error) {
        warnings.push(this.file_warning("internal_file_parse_failed", file, name, error));
      }
    }
    return { items, warnings };
  }

  /** 容器清单拥有零条目和跳过文件，导出不从翻译条目反推清单。 */
  public async write_to_path(items: Item[], context: FileFormatServiceWriteContext): Promise<void> {
    if (!context.source_files.some((file) => file.file_type === this.adapter.file_type)) return;
    const groups = new Map<string, Map<string, Item[]>>();
    for (const item of items) {
      if (item.file_type !== this.adapter.file_type) continue;
      const internal = this.adapter.internal_path(item);
      const files = groups.get(item.file_path) ?? new Map<string, Item[]>();
      const group = files.get(internal) ?? [];
      group.push(item);
      files.set(internal, group);
      groups.set(item.file_path, files);
    }
    assert_source_file_paths(context.source_files);
    // 全部容器路径检查完成后再落盘，防止非法清单留下部分导出。
    const outputs: Array<{
      file: string;
      member: JSZip.JSZipObject;
      items: Item[];
      handler: GameMemberHandler;
    }> = [];
    for (const file of context.source_files) {
      if (file.file_type !== this.adapter.file_type) continue;
      const content = await context.asset_reader(file.path);
      if (content === null)
        throw new AppError("file.not_found", { public_details: { file: file.path } });
      const { members: files } = await read_game_container(content, file.path);
      const handler = await this.adapter.create_members(files);
      const group = groups.get(file.path);
      for (const internal of group?.keys() ?? []) {
        if (!files.has(internal))
          throw new AppError("file.invalid_structure", { public_details: { file: file.path } });
      }
      const directory = source_file_output_path(file.path, file.file_type);
      for (const [name, member] of files) {
        outputs.push({
          file: directory + "/" + name,
          member,
          items: group?.get(name) ?? [],
          handler,
        });
      }
    }
    for (const output of outputs) {
      const content = await output.handler.render(
        await output.member.async("uint8array"),
        output.member.name,
        output.items,
      );
      await this.fs.write_file(path.join(context.paths.translated_path, output.file), content);
    }
  }

  /** 文件级遗漏与脚本级警告共用现有操作日志。 */
  private file_warning(
    code: SourceFileParseWarning["code"],
    file: string,
    internal: string,
    error: unknown,
  ): SourceFileParseWarning {
    return {
      code,
      rel_path: file,
      internal_file_path: internal,
      diagnostics: [
        {
          message: error instanceof Error ? error.message : String(error),
          line: null,
          column: null,
        },
      ],
    };
  }
}

/** 列出游戏目录中的全部文件，链接不跟随也不收录。 */
function list_game_files(root: string, fs: NativeFs, signal?: AbortSignal): string {
  const names: string[] = [];
  const visit = (relative: string): void => {
    signal?.throwIfAborted();
    for (const entry of fs.read_dirents(path.join(root, relative))) {
      const name = relative === "" ? entry.name : relative + "/" + entry.name;
      if (relative === "" && is_preparation_path(name)) continue;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && !/[\r\n]/u.test(name)) names.push(name); // 行格式无法表示含换行的名称。
    }
  };
  visit("");
  return names.sort().join("\n");
}
