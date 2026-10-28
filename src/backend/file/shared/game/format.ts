import type { GameDirectoryOperations } from "./game-directory-operations";
import { write_game_directory } from "./directory";
import { validate_game_path, assert_game_path_spellings } from "../../source-file-paths";
import type { GameFileType } from "../../../../shared/project-source-formats";
import path from "node:path";
import JSZip from "jszip";
import type { NativeFs } from "../../../../native/native-fs";
import type { Item } from "../../../../domain/item";
import { AppError, to_log_error } from "../../../../shared/error";
import type {
  FileFormatServiceWriteContext,
  SourceFileParseWarning,
} from "../../file-format-types";

import { assert_source_file_paths, source_file_output_path } from "../../source-file-paths";
import { read_zip_members } from "../zip-members";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";

/** 应用生成物占用明确标记的路径，与游戏原稿共同检查冲突。 */
export const GAME_FILES_MEMBER = "game_files.reference.txt";
const LEGACY_GAME_FILES_MEMBER = "game_files.txt"; // 旧容器的清单名称，读取时仍需识别。
export const GAME_METADATA_MEMBER = "__metadata__.json";

export type GameFiles = ReadonlyMap<string, JSZip.JSZipObject>;
/** 原稿与解析输入分开返回：导出只写出原稿，适配器与可读视图解析同一份输入。 */
export type GameContainer = Readonly<{
  members: GameFiles; // 参与常规导出的翻译原稿。
  input: GameFiles; // 翻译原稿加格式元数据，`create_members` 与 `workspace_projections` 共用，保证视图与条目同源。
  additional: GameFiles; // 附加原稿只展开字节，不进入解析和常规导出。
  game_files: JSZip.JSZipObject | null; // 早于清单的容器没有该成员。
}>;

/** 格式元数据和文件清单不能单独构成游戏资产。 */
export async function read_game_container(
  content: Uint8Array,
  file: string,
  has_metadata = false,
  additional_files: readonly string[] = [],
): Promise<GameContainer> {
  const input = new Map(await read_zip_members(content, file));
  const additional = new Map<string, JSZip.JSZipObject>();
  for (const name of additional_files) {
    const member = input.get(name);
    if (!member) throw new AppError("file.invalid_structure", { public_details: { file } }); // 清单与资产同事务提交，缺失成员说明资产已损坏。
    additional.set(name, member);
    input.delete(name);
  }
  const game_files = input.get(GAME_FILES_MEMBER) ?? input.get(LEGACY_GAME_FILES_MEMBER) ?? null;
  input.delete(GAME_FILES_MEMBER);
  input.delete(LEGACY_GAME_FILES_MEMBER); // 已登记的真实同名文件已分流至 additional。
  // 只有显式声明元数据的格式使用保留入口，旧格式的同名普通成员仍是原稿。
  const members = new Map(input);
  if (has_metadata) members.delete(GAME_METADATA_MEMBER);
  if (members.size + additional.size === 0)
    throw new AppError("file.invalid_structure", { public_details: { file } });
  return { members, input, additional, game_files };
}

/** 单个成员的提取结果，完整性单独决定已有资产能否替换。 */
export type GameMemberRead = Readonly<{
  items: Item[];
  warnings: SourceFileParseWarning[];
  extraction_complete?: boolean;
}>;
/** 资产汇总必须给出完整性，供导入与重置判断替换资格。 */
export type GameAssetRead = Required<GameMemberRead>;
/** 按成员组织的读取结果。共享层统一转换资产路径、连续行号、诊断和完整性。 */
export type GameReadResult = Readonly<
  { name: string } & ({ ok: true; read: GameMemberRead } | { ok: false; error: unknown })
>;
/** 导出序列的一项输出。原稿成员必须全部且只输出一次，生成资源不能占用原稿或保留路径。 */
export type GameOutput = Readonly<{
  name: string;
  bytes: Uint8Array;
  kind: "original" | "generated";
}>;
type GameAdapterBase = {
  file_type: GameFileType;
  has_metadata?: boolean; // 显式声明后才占用元数据路径，避免改变旧资产的普通成员身份。
  internal_path(item: Item): string; // 条目坐标绑定固化原稿中的成员。
};
/** 逐成员独立解析与写回的格式。 */
export type GameMemberAdapter = GameAdapterBase & {
  scope: "member";
  create_members(files: GameFiles): Promise<GameMemberHandler>; // 创建本次操作独享的成员处理器。
};
/** 成员之间存在跨成员语义的格式，由格式持有整个资产的读写流程。 */
export type GameAssetAdapter = GameAdapterBase & {
  scope: "asset";
  read_asset(input: GameFiles, signal?: AbortSignal): Promise<GameReadResult[]>;
  /** 按成员交付输出字节，序列内持有本次导出的语义状态。条目归属已由共享层验证。 */
  export_files(
    input: GameFiles,
    items: readonly Item[],
    signal: AbortSignal,
  ): AsyncIterable<GameOutput>;
};
/** 格式提供解析与写回，公共流程持有原稿清单和目录 IO。共享层每个操作只按 `scope` 分发一次。 */
export type GameFormatAdapter = GameMemberAdapter | GameAssetAdapter;
/** 本次容器操作独享解析上下文，成员只接收自身内容。 */
export interface GameMemberHandler {
  read_file(content: Uint8Array, file: string): Promise<GameMemberRead>; // 共享层按成员归集解析失败。
  render(content: Uint8Array, file: string, items: readonly Item[]): Promise<Uint8Array>; // 应用译文或返回未修改的原字节。
}
/** 游戏原稿容器负责固化、解析与目录导出，格式适配器解释成员内容。 */
export class GameFormat {
  /** 每个处理器固定其格式适配器和文件入口。 */
  public constructor(
    private readonly game_directory_operations: GameDirectoryOperations,
    private readonly adapter: GameFormatAdapter,
    private readonly fs: NativeFs,
  ) {}
  /** 容器固化调用方本次读定的原稿字节，只负责数据结构。 */
  public async create_container(
    files: ReadonlyMap<string, Uint8Array>,
    file: string,
    game_files: string,
    signal?: AbortSignal,
    metadata?: Uint8Array,
  ): Promise<Uint8Array> {
    signal?.throwIfAborted();
    assert_game_path_spellings([...files.keys()]); // 在固化边界统一检查翻译成员与附加原稿的目录拼写。
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
    zip.file(GAME_FILES_MEMBER, game_files);
    // 资产存储层统一使用 Zstd 压缩，容器只保存结构和字节，避免重复压缩。
    const content = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    signal?.throwIfAborted();
    return content;
  }

  /** 离线重建解析容器原稿，与首次导入共用结果归集。 */
  public async read_from_stream(
    content: Uint8Array,
    file: string,
    additional_files: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<GameAssetRead> {
    const { input } = await read_game_container(
      content,
      file,
      this.adapter.has_metadata,
      additional_files,
    );
    if (this.adapter.scope === "asset")
      return this.collect_read(await this.adapter.read_asset(input, signal), file);
    const handler = await this.adapter.create_members(input);
    const results: GameReadResult[] = [];
    for (const [name, member] of input) {
      signal?.throwIfAborted();
      try {
        results.push({
          name,
          ok: true,
          read: await handler.read_file(await member.async("uint8array"), name),
        });
      } catch (error) {
        signal?.throwIfAborted();
        results.push({ name, ok: false, error });
      }
    }
    return this.collect_read(results, file);
  }

  /** 成员结果转换为资产结果：行号在外层资产内连续，成员失败记为遗漏。 */
  public collect_read(results: readonly GameReadResult[], file: string): GameAssetRead {
    const items: Item[] = [];
    const warnings: SourceFileParseWarning[] = [];
    let extraction_complete = true;
    for (const result of results) {
      if (!result.ok) {
        extraction_complete = false;
        warnings.push(
          this.file_warning("internal_file_parse_failed", file, result.name, result.error),
        );
        continue;
      }
      if (result.read.extraction_complete === false) extraction_complete = false;
      warnings.push(
        ...result.read.warnings.map((warning) => ({
          ...warning,
          rel_path: file,
          internal_file_path: result.name,
        })),
      );
      for (const item of result.read.items)
        items.push({ ...item, file_path: file, row: items.length });
    }
    return { items, warnings, extraction_complete };
  }

  /** 容器清单拥有零条目和跳过文件，导出不从翻译条目反推清单。 */
  public async write_to_path(items: Item[], context: FileFormatServiceWriteContext): Promise<void> {
    if (!context.source_files.some((file) => file.file_type === this.adapter.file_type)) return;
    const groups = new Map<string, Item[]>();
    for (const item of items) {
      if (item.file_type !== this.adapter.file_type) continue;
      const group = groups.get(item.file_path) ?? [];
      group.push(item);
      groups.set(item.file_path, group);
    }
    assert_source_file_paths(context.source_files);
    const failures: unknown[] = [];
    for (const file of context.source_files) {
      if (file.file_type !== this.adapter.file_type) continue;
      const directory = source_file_output_path(file.path, file.file_type);
      const root = path.join(context.paths.translated_path, directory);
      await this.game_directory_operations
        .run([root], async (signal) => {
          const content = await context.asset_reader(file.path);
          if (content === null)
            throw new AppError("file.not_found", { public_details: { file: file.path } });
          const { members, input, additional } = await read_game_container(
            content,
            file.path,
            this.adapter.has_metadata,
            context.additional_files?.[file.path],
          );
          const asset_items = groups.get(file.path) ?? [];
          for (const item of asset_items)
            if (!input.has(this.adapter.internal_path(item)))
              throw new AppError("file.invalid_structure", { public_details: { file: file.path } });
          const outputs =
            this.adapter.scope === "asset"
              ? this.adapter.export_files(input, asset_items, signal)
              : this.render_members(
                  await this.adapter.create_members(input),
                  members,
                  asset_items,
                  signal,
                );
          await write_game_directory(
            root,
            this.fs,
            (staging) => this.stage_outputs(outputs, staging, members, additional, signal),
            signal,
            this.game_directory_operations.report_cleanup,
          );
        })
        .catch((error: unknown) => {
          if (error instanceof AppError && error.code === "runtime.disposed") throw error;
          failures.push(error);
        });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Game assets could not be exported");
  }

  /** 成员级格式按成员独立写回，未修改的成员返回原字节。 */
  private async *render_members(
    handler: GameMemberHandler,
    members: GameFiles,
    items: readonly Item[],
    signal: AbortSignal,
  ): AsyncGenerator<GameOutput> {
    const group = new Map<string, Item[]>();
    for (const item of items) {
      const internal = this.adapter.internal_path(item);
      const entries = group.get(internal) ?? [];
      entries.push(item);
      group.set(internal, entries);
    }
    for (const [name, member] of members) {
      signal.throwIfAborted();
      const content = await member.async("uint8array");
      yield {
        name,
        bytes: await handler.render(content, name, group.get(name) ?? []),
        kind: "original",
      };
    }
  }

  /** 写入暂存前逐项检查输出边界，序列结束且原稿成员齐全后才交给目录事务提交。 */
  private async stage_outputs(
    outputs: AsyncIterable<GameOutput>,
    staging: string,
    members: GameFiles,
    additional: GameFiles,
    signal: AbortSignal,
  ): Promise<{ writes: string[] }> {
    // 生成资源不能冒充原稿、附加原稿、元数据或文件清单。
    const occupied = new ProjectAssetPathIndex();
    for (const name of [...members.keys(), ...additional.keys(), GAME_FILES_MEMBER])
      occupied.reserve(name);
    if (this.adapter.has_metadata) occupied.reserve(GAME_METADATA_MEMBER);
    const pending = new Set(members.keys()); // 尚未输出的原稿成员。
    const written = new ProjectAssetPathIndex(); // 重复输出、大小写冲突与文件目录前缀冲突。
    const writes: string[] = [];
    for await (const output of outputs) {
      signal.throwIfAborted();
      validate_game_path(output.name);
      if (output.kind === "original") {
        if (!pending.delete(output.name))
          throw new Error("Unexpected game original output: " + output.name);
      } else if (occupied.find_conflict(output.name) !== null)
        throw new Error("Generated output conflicts with game originals: " + output.name);
      written.add(output.name);
      await this.fs.write_file(path.join(staging, output.name), output.bytes);
      writes.push(output.name);
    }
    const [missing] = pending;
    if (missing !== undefined) throw new Error("Missing game original output: " + missing);
    return { writes };
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
      error: to_log_error(error),
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
