import type { Static } from "typebox";
import { GENERIC_ITEMS_SCHEMA, read_archive_records } from "../shared/archive-records";
import { create_item, type Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { read_zip_members } from "../shared/zip-members";
import { write_message_records } from "../shared/message-records";

/** 通用资产只解释记录结构，底稿和私有定位由产品 Agent 维护。`.media` 共用同一记录契约。 */
export class GenericFormat {
  public constructor(private readonly file_type: "GENERIC" | "MEDIA" = "GENERIC") {}

  /** 完整验证后才建立条目，坏记录不能被过滤后改变后续坐标。 */
  private async read_records(
    content: Uint8Array,
    file: string,
  ): Promise<Static<typeof GENERIC_ITEMS_SCHEMA>> {
    try {
      return await read_archive_records(await read_zip_members(content, file));
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
        file_type: this.file_type,
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
