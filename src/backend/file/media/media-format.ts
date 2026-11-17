import { create_item, type Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { read_media_items, read_media_package_manifest } from "../../../shared/media-package";
import { read_package_items } from "../shared/package-items";
import { write_message_records } from "../shared/message-records";
import { read_zip_members } from "../shared/zip-members";

const MEDIA_MANIFEST_MEMBER = "media.json";

/** `.media` 先校验正式清单，再按固定数组坐标建立和写回条目。 */
export class MediaFormat {
  private async read_package(content: Uint8Array, file: string) {
    try {
      const members = await read_zip_members(content, file);
      const manifest_member = members.get(MEDIA_MANIFEST_MEMBER);
      if (!manifest_member) throw new Error(`Missing ${MEDIA_MANIFEST_MEMBER}`);
      const manifest = read_media_package_manifest(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await manifest_member.async("uint8array"),
          ),
        ),
      );
      const records = read_media_items(
        await read_package_items(members),
        manifest.duration,
        manifest.video,
      );
      return { records };
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
    }
  }

  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    const { records } = await this.read_package(content, file);
    return records.map((record, row) =>
      create_item({
        src: record.message,
        name_src: record.name ?? null,
        row,
        file_type: "MEDIA",
        file_path: file,
      }),
    );
  }

  public async render_text(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
  ): Promise<string> {
    const { records } = await this.read_package(content, file);
    write_message_records(records, items, file);
    return JSON.stringify(records, null, 4);
  }
}
