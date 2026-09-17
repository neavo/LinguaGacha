import path from "node:path";

import { Item } from "../../../../domain/item";
import { read_json_record } from "../../../../domain/json";
import { decode_text_content } from "../../../../shared/utils/text-tool";
import { group_items, write_text_file, type ExportPaths } from "../file-format-shared";
import { parse_markdown_v2_document } from "./md-v2-document";

type MarkdownV2ItemMetadata = {
  before: string; // Item 前方原始 Markdown 布局
  after: string; // 文档末 Item 后方原始 Markdown 布局
};

/**
 * 当前 Markdown 格式以 AST 块为持久和写回单元，块内资源引用保持原始文本。
 */
export class MDV2Format {
  /** 把 Markdown AST 块转换为通用 Item，并只持久化重建布局需要的 metadata。 */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    return this.read_text(await decode_text_content(content), rel_path);
  }

  /** 把已解码 Markdown 文本转换为通用块 Item。 */
  public read_text(text: string, rel_path: string): Item[] {
    const document = parse_markdown_v2_document(text);
    return document.units.map((unit) =>
      Item.from_json({
        src: unit.src,
        dst: "",
        row: unit.start_line,
        file_type: "MD_V2",
        file_path: rel_path,
        text_type: "MD",
        status: unit.rule_skipped ? "RULE_SKIPPED" : "NONE",
        extra_field: {
          markdown: {
            before: unit.before,
            after: unit.after,
          },
        },
      }),
    );
  }

  /** 按块起始行恢复原布局并写出当前块文本。 */
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, file_items] of group_items(items, "MD_V2")) {
      const content = this.write_text(file_items);
      await write_text_file(path.join(paths.translated_path, rel_path), content);
    }
  }

  /** 按块起始行重建 Markdown。 */
  public write_text(items: Item[]): string {
    return [...items]
      .sort((left, right) => left.row - right.row || (left.id ?? 0) - (right.id ?? 0))
      .map((item) => {
        const metadata = this.read_metadata(item);
        return metadata.before + item.effective_dst() + metadata.after;
      })
      .join("");
  }

  /** 损坏或缺失的布局字段收窄为空串，保证现有 Item 文本仍可导出。 */
  private read_metadata(item: Item): MarkdownV2ItemMetadata {
    const markdown = read_json_record(read_json_record(item.extra_field)["markdown"]);
    return {
      before: typeof markdown["before"] === "string" ? markdown["before"] : "",
      after: typeof markdown["after"] === "string" ? markdown["after"] : "",
    };
  }
}
