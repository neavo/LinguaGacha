import type { GameFormatAdapter } from "../shared/game/format";
import path from "node:path";
import { AppError } from "../../../shared/error";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { read_rpgmaker_metadata } from "./item";
import { create_rpgmaker_extractor } from "./extractor";
import { read_rpgmaker_json } from "./json";
import { write_rpgmaker_items } from "./writer";
import { RPGMakerJsonCodec } from "./json-codec";

/** 成员处理器只解释内容和持久定位。 */
export function create_rpgmaker_mv_mz_adapter(): GameFormatAdapter {
  return {
    file_type: "RPGMAKER_MV_MZ",
    internal_path: (item) => read_rpgmaker_metadata(item.extra_field).internal_file_path,
    create_members: async () => ({
      /** JSON 成员按事件提取，其余成员按 JavaScript 提取持久定位。 */
      read_file: async (content, file) => {
        const source = await decode_text_content(content);
        if (path.extname(file).toLowerCase() === ".json")
          return read_rpgmaker_json(JSON.parse(source), file);
        const { items, warnings, script } = create_rpgmaker_extractor(file);
        script(source, { kind: "field", path: [] }); // 空路径指向整个 JS 原稿。
        return { items, warnings };
      },
      /** 完成译文按持久定位写回，数值字面量沿用本次原稿记录。 */
      render: async (content, file, items) => {
        const completed = items.filter((item) => item.status === "PROCESSED");
        if (completed.length === 0) return content;
        try {
          const source = await decode_text_content(content);
          const json = path.extname(file).toLowerCase() === ".json";
          const codec = new RPGMakerJsonCodec(); // 每次渲染独占数值原稿记录。
          const root = write_rpgmaker_items(json ? codec.parse(source) : source, completed, codec);
          return Buffer.from(json ? codec.stringify(root) : String(root));
        } catch (cause) {
          throw new AppError("file.invalid_structure", { cause, public_details: { file } });
        }
      },
    }),
  };
}
