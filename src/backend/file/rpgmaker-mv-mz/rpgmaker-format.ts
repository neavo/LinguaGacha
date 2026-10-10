import path from "node:path";
import { create_item, type Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { decode_text_content } from "../../../shared/utils/text-tool";
import type { FileFormatServiceConfig } from "../file-format-shared";
import { read_javascript_strings } from "./javascript";
import { read_rpgmaker_json } from "./json";
import { write_rpgmaker_items } from "./writer";

/** 格式门面固定配置并把定位错误归一为文件解析错误。 */
export class RPGMakerMvMzFormat {
  /** 导入与导出共用本次操作的设置快照。 */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /** 仅导入和明确重建生成定位，导出消费保存的定位。 */
  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    const source = await decode_text_content(content);
    if (path.extname(file).toLowerCase() === ".json")
      return read_rpgmaker_json(JSON.parse(source), file);
    return read_javascript_strings(source).map((span, row) =>
      create_item({
        src: span.src,
        row,
        file_path: file,
        file_type: "RPGMAKER_MV_MZ",
        status: "RULE_SKIPPED",
        extra_field: {
          rpgmaker: {
            usage: "script",
            location: {
              kind: "script",
              container: { kind: "field", path: [] },
              start: span.start,
              end: span.end,
              template: span.template,
            },
          },
        },
      }),
    );
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
      const root = write_rpgmaker_items(json ? JSON.parse(source) : source, completed, this.config);
      return Buffer.from(json ? JSON.stringify(root) : String(root));
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
    }
  }
}
