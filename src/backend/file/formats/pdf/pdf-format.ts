import path from "node:path";

import { Item } from "../../../../domain/item";
import { group_items, write_binary_file, type FileFormatWriteContext } from "../file-format-shared";
import { MDV2Format } from "../markdown/md-v2-format";
import { read_pdf_document } from "./pdf-document-reader";

/** PDF 只拥有源格式身份和宿主写回，文本语义完全复用 Markdown V2。 */
export class PDFFormat {
  private readonly markdown = new MDV2Format();

  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const { markdown } = await read_pdf_document(content);
    return this.markdown.read_text(markdown, rel_path).map((item) =>
      Item.from_json({
        ...item.to_json(),
        file_type: "PDF",
      }),
    );
  }

  public async write_to_path(items: Item[], context: FileFormatWriteContext): Promise<void> {
    for (const [rel_path, file_items] of group_items(items, "PDF")) {
      let source_markdown: string | null = null;
      try {
        const source = context.asset_reader(rel_path);
        if (source !== null) source_markdown = (await read_pdf_document(source)).markdown;
      } catch {
        // 原始 PDF 二次转换只服务资源恢复；失败不阻止当前译文重新排版。
      }
      const markdown = this.markdown.write_text(file_items, source_markdown);
      await write_binary_file(
        path.join(context.paths.translated_path, rel_path),
        await context.render_pdf(markdown),
      );
    }
  }
}
