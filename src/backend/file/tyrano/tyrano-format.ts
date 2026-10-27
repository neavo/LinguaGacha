import assert from "node:assert/strict";
import { read_json_record } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { GAME_METADATA_MEMBER, type GameFormatAdapter } from "../shared/game/format";
import { read_tyrano_metadata } from "./item";
import { read_tyrano_member, render_tyrano_member } from "./member";
import { TYRANO_PARSERS, type SceneSyntax, type TyranoParser } from "./scene";

/** 每次容器操作从元数据读定解析语义，成员只按自身内容提取和写回。 */
export function create_tyrano_adapter(): GameFormatAdapter {
  return {
    file_type: "TYRANO",
    has_metadata: true,
    internal_path: (item) => read_tyrano_metadata(item.extra_field).internal_file_path,
    /** 元数据与原稿共同固化，本次操作只采用这一份解析语义。 */
    async create_members(files) {
      const member = files.get(GAME_METADATA_MEMBER);
      assert(member, "Missing TyranoScript format metadata; import the game again");
      const metadata = read_json_record(JSON.parse(await member.async("string")) as unknown);
      assert(
        TYRANO_PARSERS.includes(metadata["parser"] as TyranoParser) &&
          typeof metadata["keep_space"] === "string",
        "Invalid TyranoScript format metadata",
      );
      const syntax = metadata as unknown as SceneSyntax;
      return {
        /** 元数据参与离线重建，但不产生翻译条目。 */
        read_file: async (content, file) =>
          file === GAME_METADATA_MEMBER
            ? { items: [], warnings: [] }
            : read_tyrano_member(content, file, syntax),
        /** 携带成员路径上报失败，由共享目录事务结束本资产的输出。 */
        render: async (content, file, items) => {
          try {
            return render_tyrano_member(content, file, syntax, items);
          } catch (cause) {
            throw new AppError("file.invalid_structure", { cause, public_details: { file } });
          }
        },
      };
    },
  };
}
