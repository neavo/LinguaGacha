import { RPGMakerGameFormat } from "../shared/rpgmaker-format";
import path from "node:path";
import { default_native_fs, type NativeFs } from "../../../native/native-fs";
import type { Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { decode_text_content } from "../../../shared/utils/text-tool";
import type { FileFormatServiceConfig, SourceFileParseWarning } from "../file-format-types";
import { read_rpgmaker_metadata } from "./item";
import { create_rpgmaker_extractor } from "./extractor";
import { read_rpgmaker_json } from "./json";
import { write_rpgmaker_items } from "./writer";
import { RPGMakerJsonCodec } from "./json-codec";

/** 格式门面固定配置并把定位错误归一为文件解析错误。 */
export class RPGMakerMvMzFormat extends RPGMakerGameFormat {
  /** 导入与导出共用本次操作的设置快照。 */
  public constructor(
    private readonly config: FileFormatServiceConfig,
    fs: NativeFs = default_native_fs,
  ) {
    super(
      {
        file_type: "RPGMAKER_MV_MZ",
        internal_path: (item) => read_rpgmaker_metadata(item.extra_field).internal_file_path,
        read_file: (content, file) => this.read_file(content, file),
        render: (content, file, items) => this.render(content, file, items),
      },
      fs,
    );
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
