import path from "node:path";
import type { Item } from "../../../domain/item";
import { default_native_fs, type NativeFs } from "../../../native/native-fs";
import { AppError } from "../../../shared/error";
import { RPGMakerGameFormat, type GameFiles } from "../shared/rpgmaker-format";
import { read_rgss_game } from "./source";
import { read_rgss_metadata } from "./item";
import { decode, encode } from "./marshal";
import { read_rgss_data, write_rgss_data } from "./data";

/** RGSS 处理器解释成员内容，容器生命周期由共享格式流程持有。 */
export class RPGMakerRGSSFormat extends RPGMakerGameFormat {
  /** 固定本次操作的文件入口，并绑定读取和渲染能力。 */
  public constructor(fs: NativeFs = default_native_fs) {
    super(
      {
        file_type: "RPGMAKER_RGSS",
        internal_path: (item) => read_rgss_metadata(item.extra_field).internal_file_path,
        read_file: async (content, file, files) => {
          if (path.extname(file).toLowerCase() === ".ini") return { items: [], warnings: [] };
          const game = await read_rgss_game(files);
          return read_rgss_data(
            decode(content),
            file,
            game.version,
            file.toLowerCase() === game.scripts.toLowerCase(),
          );
        },
        render: (content, file, items, files) => this.render(content, file, items, files),
      },
      fs,
    );
  }
  /** 未修改成员保留原字节，译文定位或编码失败统一进入生成错误。 */
  private async render(
    content: Uint8Array,
    file: string,
    items: readonly Item[],
    files: GameFiles,
  ): Promise<Uint8Array> {
    const completed = items.filter((item) => item.status === "PROCESSED" && item.dst !== item.src);
    if (!completed.length) return content;
    try {
      const game = await read_rgss_game(files),
        root = decode(content);
      await write_rgss_data(root, completed, game.version);
      return encode(root);
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
    }
  }
}
