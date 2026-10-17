import path from "node:path";
import { AppError } from "../../../shared/error";
import type { GameFormatAdapter } from "../shared/game/format";
import { read_rgss_game } from "./source";
import { read_rgss_metadata } from "./item";
import { decode, encode } from "./marshal";
import { read_rgss_data, write_rgss_data } from "./data";

/** 每次容器操作创建独立上下文，成员处理器拥有解析与渲染。 */
export function create_rpgmaker_rgss_adapter(): GameFormatAdapter {
  return {
    file_type: "RPGMAKER_RGSS",
    internal_path: (item) => read_rgss_metadata(item.extra_field).internal_file_path,
    create_members: async (files) => {
      // 按需共享成功或失败，身份错误仍由成员读取和译文生成各自处理。
      let game: ReturnType<typeof read_rgss_game> | undefined;
      const read_game = () => (game ??= read_rgss_game(files));
      return {
        /** 配置原字节保留，数据成员共用版本与脚本入口解释 Marshal 内容。 */
        read_file: async (content, file) => {
          if (path.extname(file).toLowerCase() === ".ini") return { items: [], warnings: [] };
          const game = await read_game();
          return read_rgss_data(
            decode(content),
            file,
            game.version,
            file.toLowerCase() === game.scripts.toLowerCase(),
          );
        },
        /** 无修改成员直接保留原字节，身份失败只阻止实际译文写回。 */
        render: async (content, file, items) => {
          const completed = items.filter(
            (item) => item.status === "PROCESSED" && item.dst !== item.src,
          );
          if (!completed.length) return content;
          try {
            const game = await read_game(),
              root = decode(content);
            await write_rgss_data(root, completed, game.version);
            return encode(root);
          } catch (cause) {
            throw new AppError("file.invalid_structure", { cause, public_details: { file } });
          }
        },
      };
    },
  };
}
