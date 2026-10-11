import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import path from "node:path";
import JSZip from "jszip";
import { default_native_fs, type NativeFs } from "../../../native/native-fs";
import type { Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { decode_text_content } from "../../../shared/utils/text-tool";
import type {
  FileFormatServiceConfig,
  FileFormatServiceWriteContext,
  SourceFileParseWarning,
} from "../file-format-shared";
import { collect_rpgmaker_files, discover_rpgmaker_source } from "./source";
import { read_rpgmaker_metadata, validate_rpgmaker_path } from "./item";
import { create_rpgmaker_extractor } from "./extractor";
import { read_rpgmaker_json } from "./json";
import { write_rpgmaker_items } from "./writer";
import { RPGMakerJsonCodec } from "./json-codec";

/** 格式门面固定配置并把定位错误归一为文件解析错误。 */
export class RPGMakerMvMzFormat {
  /** 导入与导出共用本次操作的设置快照。 */
  public constructor(
    private readonly config: FileFormatServiceConfig,
    private readonly fs: NativeFs = default_native_fs,
  ) {}

  /** 读取失败仅跳过当前文件，成功取得的字节始终保存在容器内。 */
  public async prepare_source(
    source: string,
    file: string,
  ): Promise<{ content: Uint8Array; warnings: SourceFileParseWarning[] }> {
    const game = discover_rpgmaker_source(source, this.fs);
    if (game === null)
      throw new AppError("file.invalid_structure", { public_details: { file: source } });
    const zip = new JSZip();
    const warnings: SourceFileParseWarning[] = [];
    const paths = new Set<string>();
    for (const entry of collect_rpgmaker_files(game, this.fs)) {
      const internal = validate_rpgmaker_path(entry.rel_path);
      const key = internal.toLowerCase();
      if (paths.has(key))
        throw new AppError("file.invalid_structure", { public_details: { file } });
      paths.add(key);
      try {
        zip.file(internal, this.fs.read_file(entry.source_path), { createFolders: false });
      } catch (error) {
        warnings.push(this.file_warning("internal_file_read_failed", file, internal, error));
      }
    }
    if (Object.keys(zip.files).length === 0)
      throw new AppError("file.parse_failed", { public_details: { file } });
    return {
      content: await zip.generateAsync({ type: "uint8array", compression: "STORE" }),
      warnings,
    };
  }

  /** 首次导入与离线重建共用容器解析，行号在外层资产内连续。 */
  public async read_from_stream(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }> {
    const zip = await this.read_container(content, file);
    const items: Item[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      try {
        const parsed = await this.read_file(await entry.async("uint8array"), entry.name);
        warnings.push(
          ...parsed.warnings.map((warning) => ({
            ...warning,
            rel_path: file,
            internal_file_path: entry.name,
          })),
        );
        for (const item of parsed.items)
          items.push({ ...item, file_path: file, row: items.length });
      } catch (error) {
        warnings.push(this.file_warning("internal_file_parse_failed", file, entry.name, error));
      }
    }
    return { items, warnings };
  }

  /** 容器清单拥有零条目和跳过文件，导出不从翻译条目反推清单。 */
  public async write_to_path(items: Item[], context: FileFormatServiceWriteContext): Promise<void> {
    if (!context.source_files.some((file) => file.file_type === "RPGMAKER_MV_MZ")) return;
    const groups = new Map<string, Map<string, Item[]>>();
    for (const item of items) {
      if (item.file_type !== "RPGMAKER_MV_MZ") continue;
      const internal = read_rpgmaker_metadata(item.extra_field).internal_file_path;
      const files = groups.get(item.file_path) ?? new Map<string, Item[]>();
      const group = files.get(internal) ?? [];
      group.push(item);
      files.set(internal, group);
      groups.set(item.file_path, files);
    }
    const outputs: Array<{ file: string; entry: JSZip.JSZipObject; items: Item[] }> = [];
    const output_paths = new ProjectAssetPathIndex(); // 展开后的路径仍按统一的文件与目录规则比较。
    for (const file of context.source_files)
      if (file.file_type !== "RPGMAKER_MV_MZ") output_paths.reserve(file.path);
    for (const file of context.source_files) {
      if (file.file_type !== "RPGMAKER_MV_MZ") continue;
      const content = context.asset_reader(file.path);
      if (content === null)
        throw new AppError("file.not_found", { public_details: { file: file.path } });
      const zip = await this.read_container(content, file.path);
      const group = groups.get(file.path);
      for (const internal of group?.keys() ?? []) {
        if (!zip.file(internal))
          throw new AppError("file.invalid_structure", { public_details: { file: file.path } });
      }
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const output = validate_rpgmaker_path(file.path) + "/" + entry.name;
        outputs.push({ file: output, entry, items: group?.get(entry.name) ?? [] });
      }
    }
    for (const output of outputs) {
      if (output_paths.find_conflict(output.file) !== null)
        throw new AppError("file.invalid_structure", { public_details: { file: output.file } });
      output_paths.reserve(output.file);
    }
    for (const output of outputs) {
      const content = await this.render(
        await output.entry.async("uint8array"),
        output.entry.name,
        output.items,
      );
      await this.fs.write_file(path.join(context.paths.translated_path, output.file), content);
    }
  }

  /** JSZip 会清理越界路径，必须同时核对清理前的名字。 */
  private async read_container(content: Uint8Array, file: string): Promise<JSZip> {
    try {
      const zip = await JSZip.loadAsync(content);
      const paths = new Set<string>();
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const name = validate_rpgmaker_path(entry.unsafeOriginalName ?? entry.name);
        const key = name.toLowerCase();
        if (name !== entry.name || paths.has(key))
          throw new Error("Duplicate or noncanonical RPG Maker path");
        paths.add(key);
      }
      if (paths.size === 0) throw new Error("Empty RPG Maker container");
      return zip;
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
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

  /** 仅导入和明确重建生成定位，导出消费保存的定位。 */
  public async read_file(
    content: Uint8Array,
    file: string,
  ): Promise<{ items: Item[]; warnings: SourceFileParseWarning[] }> {
    const source = await decode_text_content(content);
    if (path.extname(file).toLowerCase() === ".json")
      return read_rpgmaker_json(JSON.parse(source), file);
    const { items, warnings, script } = create_rpgmaker_extractor(file);
    script(source, { kind: "field", path: [] }); // 空路径指向整个 JS 原稿。
    return { items, warnings };
  }

  /** 持久定位始终指向固化原稿，写回不依赖当前提取规则。 */
  public async render(
    content: Uint8Array,
    file: string,
    items: readonly Item[],
  ): Promise<Uint8Array> {
    const completed = items.filter((item) => item.status === "PROCESSED");
    if (completed.length === 0) return content;
    try {
      const source = await decode_text_content(content);
      const json = path.extname(file).toLowerCase() === ".json";
      const codec = new RPGMakerJsonCodec();
      const root = write_rpgmaker_items(
        json ? codec.parse(source) : source,
        completed,
        this.config,
        codec,
      );
      return Buffer.from(json ? codec.stringify(root) : String(root));
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
    }
  }
}
