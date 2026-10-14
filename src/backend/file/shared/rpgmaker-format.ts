import { check_game_backup, write_game_backup } from "./rpgmaker-backup";
import { validate_game_path, assert_game_path_spellings } from "./rpgmaker-prepare";
import path from "node:path";
import JSZip from "jszip";
import type { NativeFs } from "../../../native/native-fs";
import type { Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import type {
  FileFormatServiceWriteContext,
  SourceFileParseWarning,
  ProjectSourceFileEntry,
} from "../file-format-types";
import { assert_source_file_paths, source_file_output_path } from "../source-file-paths";
import { read_zip_members } from "./zip-members";

// 引擎指令码是原稿协议，提取与写回共同引用。
export const RPGMAKER_EVENT = {
  MESSAGE: 101,
  MESSAGE_LINE: 401,
  CHOICES: 102,
  CHOICE_BRANCH: 402,
  CHOICES_END: 404,
  SCROLLING: 105,
  SCROLLING_LINE: 405,
  COMMENT: 108,
  COMMENT_LINE: 408,
  SCRIPT: 355,
  SCRIPT_LINE: 655,
  CONDITIONAL: 111,
  VARIABLES: 122,
  MOVE_SCRIPT: 45,
  ACTOR_NAME: 320,
  ACTOR_NICKNAME: 324,
  ACTOR_PROFILE: 325,
} as const;

/** RM 固化容器必须包含文件，空容器不能作为游戏原稿。 */
export async function read_rpgmaker_container(
  content: Uint8Array,
  file: string,
): Promise<ReadonlyMap<string, JSZip.JSZipObject>> {
  const files = await read_zip_members(content, file);
  if (files.size === 0) throw new AppError("file.invalid_structure", { public_details: { file } });
  return files;
}

export type GameFiles = ReadonlyMap<string, JSZip.JSZipObject>;
/** 格式提供成员解析与写回，公共流程持有原稿清单和目录 IO。 */
export interface GameFormatAdapter {
  file_type: "RPGMAKER_MV_MZ" | "RPGMAKER_RGSS";
  internal_path(item: Item): string;
  read_file(
    content: Uint8Array,
    file: string,
    files: GameFiles,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }>;
  render(
    content: Uint8Array,
    file: string,
    items: readonly Item[],
    files: GameFiles,
  ): Promise<Uint8Array>;
}
/** 游戏原稿清单拥有导入、离线重建与目录导出，格式仅解释成员内容。 */
export class RPGMakerGameFormat {
  /** 每个处理器固定其格式适配器和文件入口。 */
  public constructor(
    private readonly adapter: GameFormatAdapter,
    private readonly fs: NativeFs,
  ) {}
  /** 完整读取全部原稿并确认备份覆盖后，才允许发布容器。 */
  public async prepare_source(
    entries: readonly Pick<ProjectSourceFileEntry, "source_path" | "rel_path">[],
    file: string,
    game: Readonly<{ root: string; engine: string }>,
    signal?: AbortSignal,
  ): Promise<{ content: Uint8Array; warnings: SourceFileParseWarning[] }> {
    signal?.throwIfAborted();
    const files = new Map<string, Uint8Array>(); // 同一次读取供容器和首次备份使用。
    assert_game_path_spellings(entries.map((entry) => entry.rel_path));
    const zip = new JSZip();
    const paths = new Set<string>();
    for (const entry of entries) {
      signal?.throwIfAborted();
      const internal = entry.rel_path;
      validate_game_path(internal);
      const key = internal.toLowerCase();
      if (paths.has(key))
        throw new AppError("file.invalid_structure", { public_details: { file } });
      paths.add(key);
      const bytes = this.fs.read_file(entry.source_path);
      zip.file(internal, bytes, { createFolders: false });
      files.set(internal, bytes);
    }
    if (Object.keys(zip.files).length === 0)
      throw new AppError("file.parse_failed", { public_details: { file } });
    const existing_backup = check_game_backup(game.root, game.engine, [...files.keys()], this.fs);
    const content = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    signal?.throwIfAborted();
    if (!existing_backup) await write_game_backup(game.root, game.engine, files, this.fs, signal);
    return { content, warnings: [] };
  }

  /** 首次导入与离线重建共用容器解析，行号在外层资产内连续。 */
  public async read_from_stream(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }> {
    const files = await read_rpgmaker_container(content, file);
    const items: Item[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const [name, member] of files) {
      try {
        const parsed = await this.adapter.read_file(await member.async("uint8array"), name, files);
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
      files: GameFiles;
    }> = [];
    for (const file of context.source_files) {
      if (file.file_type !== this.adapter.file_type) continue;
      const content = await context.asset_reader(file.path);
      if (content === null)
        throw new AppError("file.not_found", { public_details: { file: file.path } });
      const files = await read_rpgmaker_container(content, file.path);
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
          files,
        });
      }
    }
    for (const output of outputs) {
      const content = await this.adapter.render(
        await output.member.async("uint8array"),
        output.member.name,
        output.items,
        output.files,
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
