import { create_item, type Item } from "../../../domain/item";
import type { ImageBook, ImageRecord, ImageWritebackItem } from "../../../shared/image-package";
import { index_message_items } from "../shared/message-records";
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

/** 图片格式对齐同一份原稿的条目与工程译文。 */
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
      items: records.map((record, row) => {
        const region = regions.get(record.pageId + "/" + record.regionId)!;
        return create_item({
          src: record.message,
          row,
          tag: region.kind,
          status: region.kind === "unframed" || region.parts ? "EXCLUDED" : "NONE",
          file_type: "IMAGE",
          file_path: file,
        });
      }),
      image: { book, records },
    };
  }

  /** 将条目状态固定为本次技能写回的结果。 */
  public async render_text(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
  ): Promise<string> {
    const { records } = await read_image_package(content, file, {
      validatePixels: false, // 生成只消费已入库的图片资产，各像素宿主仍核对消费的尺寸。
    });
    const byRow = index_message_items(records, items, file);
    const writeback = records.map<ImageWritebackItem>(({ pageId, regionId }, row) => {
      const item = byRow.get(row);
      if (item?.status === "EXCLUDED") return { pageId, regionId, output: "original" };
      const text = item && read_translation_for_generation(item);
      return text === undefined
        ? { pageId, regionId, output: null }
        : { pageId, regionId, output: "translated", text };
    });
    return JSON.stringify(writeback);
  }
}
