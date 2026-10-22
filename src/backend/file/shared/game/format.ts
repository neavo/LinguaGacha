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
} from "../../file-format-types";
import { assert_source_file_paths, source_file_output_path } from "../../source-file-paths";
import { read_zip_members } from "../zip-members";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";

/** 容器根目录的游戏文件清单，供 Agent 核对资源引用。引擎白名单不会在根目录选出 `.txt`，因此不与原稿冲突。 */
export const GAME_FILES_MEMBER = "game_files.txt";
export const GAME_METADATA_MEMBER = "__metadata__.json";

export type GameFiles = ReadonlyMap<string, JSZip.JSZipObject>;
/** 原稿与解析输入分开返回：导出只写出原稿，适配器与可读视图解析同一份输入。 */
export type GameContainer = Readonly<{
  members: GameFiles; // 原稿成员。
  input: GameFiles; // 原稿加格式元数据，`create_members` 与 `workspace_view` 共用，保证视图与条目同源。
  game_files: JSZip.JSZipObject | null; // 早于清单的容器没有该成员。
}>;

/** 固化容器必须包含原稿文件，空容器不能作为游戏原稿。 */
export async function read_game_container(
  content: Uint8Array,
  file: string,
  has_metadata = false,
): Promise<GameContainer> {
  const input = new Map(await read_zip_members(content, file));
  const game_files = input.get(GAME_FILES_MEMBER) ?? null;
  input.delete(GAME_FILES_MEMBER);
  // 只有显式声明元数据的格式使用保留入口，旧格式的同名普通成员仍是原稿。
  const members = new Map(input);
  if (has_metadata) members.delete(GAME_METADATA_MEMBER);
  if (members.size === 0)
    throw new AppError("file.invalid_structure", { public_details: { file } });
  return { members, input, game_files };
}

/** 格式提供成员解析与写回，公共流程持有原稿清单和目录 IO。 */
export interface GameFormatAdapter {
  file_type: GameFileType;
  has_metadata?: boolean; // 显式声明后才占用元数据路径，避免改变旧资产的普通成员身份。
  internal_path(item: Item): string;
  create_members(files: GameFiles): Promise<GameMemberHandler>;
}
/** 本次容器操作独享解析上下文，成员只接收自身内容。 */
export interface GameMemberHandler {
  /** 汇总本资产的全部条目，生成跨成员写回计划和额外输出。 */
  prepare_export?(items: readonly Item[]): Promise<ReadonlyMap<string, Uint8Array>>;
  read_file(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }>;
  render(content: Uint8Array, file: string, items: readonly Item[]): Promise<Uint8Array>;
}
/** 游戏原稿容器负责固化、解析与目录导出，格式适配器解释成员内容。 */
export class GameFormat {
  /** 每个处理器固定其格式适配器和文件入口。 */
  public constructor(
    private readonly adapter: GameFormatAdapter,
    private readonly fs: NativeFs,
  ) {}
  /** 容器固化调用方本次读定的原稿字节，只负责数据结构。 */
  public async create_container(
    files: ReadonlyMap<string, Uint8Array>,
    file: string,
    root: string,
    signal?: AbortSignal,
    metadata?: Uint8Array,
  ): Promise<{ content: Uint8Array; warnings: SourceFileParseWarning[] }> {
    signal?.throwIfAborted();
    assert_game_path_spellings([...files.keys()]);
    const zip = new JSZip();
    const member_paths = new ProjectAssetPathIndex();
    member_paths.add(GAME_FILES_MEMBER);
    if (this.adapter.has_metadata) member_paths.add(GAME_METADATA_MEMBER);
    for (const [internal, bytes] of files) {
      signal?.throwIfAborted();
      validate_game_path(internal);
      member_paths.add(internal);
      zip.file(internal, bytes, { createFolders: false });
    }
    if (Object.keys(zip.files).length === 0)
      throw new AppError("file.parse_failed", { public_details: { file } });
    if (metadata !== undefined) {
      if (!this.adapter.has_metadata) throw new Error("Unexpected game metadata: " + file);
      zip.file(GAME_METADATA_MEMBER, metadata, { createFolders: false });
    }
    // 准备流程已解包归档并解密媒体，此时的目录即游戏运行时可见的文件集合。
    zip.file(GAME_FILES_MEMBER, list_game_files(root, this.fs, signal));
    // 资产存储层统一使用 Zstd 压缩，容器只保存结构和字节，避免重复压缩。
    const content = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    signal?.throwIfAborted();
    return { content, warnings: [] };
  }

  /** 首次导入与离线重建共用容器解析，行号在外层资产内连续。 */
  public async read_from_stream(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }> {
    const { input } = await read_game_container(content, file, this.adapter.has_metadata);
    const handler = await this.adapter.create_members(input);
    const items: Item[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const [name, member] of input) {
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
    const generated: Array<{ file: string; content: Uint8Array }> = [];
    for (const file of context.source_files) {
      if (file.file_type !== this.adapter.file_type) continue;
      const content = await context.asset_reader(file.path);
      if (content === null)
        throw new AppError("file.not_found", { public_details: { file: file.path } });
      const { members: files, input } = await read_game_container(
        content,
        file.path,
        this.adapter.has_metadata,
      );
      const handler = await this.adapter.create_members(input);
      const group = groups.get(file.path);
      for (const internal of group?.keys() ?? []) {
        if (!input.has(internal))
          throw new AppError("file.invalid_structure", { public_details: { file: file.path } });
      }
      const directory = source_file_output_path(file.path, file.file_type);
      const extra = await handler.prepare_export?.([...(group?.values() ?? [])].flat());
      for (const [name, content] of extra ?? []) {
        validate_game_path(name);
        if (
          name.toLowerCase() === GAME_FILES_MEMBER ||
          (this.adapter.has_metadata && name.toLowerCase() === GAME_METADATA_MEMBER)
        )
          throw new Error("Generated output conflicts with reserved game metadata: " + name);
        generated.push({ file: directory + "/" + name, content });
      }
      for (const [name, member] of files) {
        outputs.push({
          file: directory + "/" + name,
          member,
          items: group?.get(name) ?? [],
          handler,
        });
      }
    }
    const index = new ProjectAssetPathIndex();
    const names = [...outputs, ...generated].map((output) => output.file);
    assert_game_path_spellings(names);
    for (const name of names) index.add(name);
    for (const output of outputs) {
      const content = await output.handler.render(
        await output.member.async("uint8array"),
        output.member.name,
        output.items,
      );
      await this.fs.write_file(path.join(context.paths.translated_path, output.file), content);
    }
    for (const output of generated)
      await this.fs.write_file(
        path.join(context.paths.translated_path, output.file),
        output.content,
      );
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
