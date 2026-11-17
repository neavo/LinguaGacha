import { create_item, type Item } from "../../../domain/item";
import type { ImageBook, ImageRecord } from "../../../shared/image-package";
import type { ImageTextInput } from "../../../shared/image-text";
import { write_message_records } from "../shared/message-records";
import { read_translation_for_generation } from "../shared/translation-generation-text";
import { read_image_package } from "./image-package";

/** 相对路径与区域号跨重新创建保持稳定，项目域据此复制已完成事实。 */
export function image_record_identities(book: ImageBook, records: readonly ImageRecord[]) {
  const pages = new Map(book.pages.map((page) => [page.pageId, page]));
  return new Map(
    records.map((record, row) => {
      const page = pages.get(record.pageId)!;
      return [
        page.relativePath.toLocaleLowerCase("en-US") + "/" + record.regionId,
        {
          row,
          source: record.message,
          image: [page.sha256, page.orientation, page.width, page.height].join(":"),
        },
      ];
    }),
  );
}

/** 从工程条目形成与固化原稿绑定的图片译文快照。 */
export async function build_image_text_input(
  content: Uint8Array,
  items: readonly Item[],
  file: string,
) {
  const { book, records, clean, members } = await read_image_package(content, file);
  write_message_records(records, items, file);
  const byRow = new Map(items.map((item) => [item.row, item]));
  const input: ImageTextInput = {
    records: records.map((record, row) => {
      const item = byRow.get(row);
      const output =
        item?.status === "PROCESSED"
          ? ("translated" as const)
          : item?.status === "EXCLUDED"
            ? ("original" as const)
            : null;
      return {
        pageId: record.pageId,
        regionId: record.regionId,
        output,
        text:
          output === "translated" && item ? (read_translation_for_generation(item) ?? null) : null,
      };
    }),
  };
  return { book, clean, input, members };
}

/** 图片格式建立工程条目；文件生成服务消费同一归档契约写出译图。 */
export class ImageFormat {
  /** 一次读取同时交付条目和已验证身份，替换流程复用这份解析结果。 */
  public async read(content: Uint8Array, file: string) {
    const { book, records } = await read_image_package(content, file);
    const regions = new Map(
      book.pages.flatMap((page) =>
        page.regions.map((region) => [page.pageId + "/" + region.regionId, region] as const),
      ),
    );
    return {
      items: records.map((record, row) =>
        create_item({
          src: record.message,
          row,
          tag: regions.get(record.pageId + "/" + record.regionId)!.kind,
          file_type: "IMAGE",
          file_path: file,
        }),
      ),
      image: { book, records },
    };
  }
}
