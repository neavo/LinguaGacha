import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import { create_item, type Item } from "../../../domain/item";
import { JSON_VALUE_SCHEMA } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { read_zip_members } from "../shared/zip-members";
import { write_message_records } from "../shared/message-records";

export const GENERIC_ITEMS_MEMBER = "items.json";
/** 包内其余成员与记录私有字段由 AGENT 解释，后端只维护正文、姓名和数组坐标。 */
export const GENERIC_ITEMS_SCHEMA = Type.Array(
  Type.Object(
    {
      message: Type.String(),
      name: Type.Optional(Type.String()),
    },
    { additionalProperties: JSON_VALUE_SCHEMA },
  ),
);
const VALIDATOR = Compile(GENERIC_ITEMS_SCHEMA); // 解析与模型声明使用同一份记录契约。

/** 通用资产只解释记录结构，底稿和私有定位由产品 Agent 维护。 */
export class GenericFormat {
  /** 完整验证后才建立条目，坏记录不能被过滤后改变后续坐标。 */
  private async read_records(
    content: Uint8Array,
    file: string,
  ): Promise<Static<typeof GENERIC_ITEMS_SCHEMA>> {
    try {
      const member = (await read_zip_members(content, file)).get(GENERIC_ITEMS_MEMBER);
      if (!member) throw new Error("Missing " + GENERIC_ITEMS_MEMBER);
      const data: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await member.async("uint8array")),
      );
      if (!VALIDATOR.Check(data)) throw new Error("Invalid generic records");
      return data;
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
    }
  }

  /** 数组下标直接成为条目坐标，空正文也保留其位置。 */
  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    return (await this.read_records(content, file)).map((record, row) =>
      create_item({
        src: record.message,
        name_src: record.name ?? null,
        row,
        file_type: "GENERIC",
        file_path: file,
      }),
    );
  }

  /** 只输出已决定最终文本的写回输入，底稿与脚本由 AGENT 自行使用。 */
  public async render_text(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
  ): Promise<string> {
    const records = await this.read_records(content, file);
    write_message_records(records, items, file);
    return JSON.stringify(records, null, 4);
  }
}
