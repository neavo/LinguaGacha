import { assert_source_file_paths, source_file_output_path } from "../source-file-paths";
import { read_rpgmaker_container } from "./container";
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
import { read_rpgmaker_metadata } from "./item";
import { create_rpgmaker_extractor } from "./extractor";
import { read_rpgmaker_json } from "./json";
import { write_rpgmaker_items } from "./writer";
import { validate_zip_member_path } from "../zip-members";
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
      const internal = validate_zip_member_path(entry.rel_path);
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
    const files = await read_rpgmaker_container(content, file);
    const items: Item[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const [name, member] of files) {
      try {
        const parsed = await this.read_file(await member.async("uint8array"), name);
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
    assert_source_file_paths(context.source_files);
    // 全部容器路径检查完成后再落盘，防止非法清单留下部分导出。
    const outputs: Array<{ file: string; member: JSZip.JSZipObject; items: Item[] }> = [];
    for (const file of context.source_files) {
      if (file.file_type !== "RPGMAKER_MV_MZ") continue;
      const content = context.asset_reader(file.path);
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
        outputs.push({ file: directory + "/" + name, member, items: group?.get(name) ?? [] });
      }
    }
    for (const output of outputs) {
      const content = await this.render(
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
