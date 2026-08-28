import path from "node:path";

import { Item } from "../../../../domain/item";
import { read_json_record } from "../../../../domain/json";
import { decode_text_content } from "../../../../shared/utils/text-tool";
import { group_items, write_text_file, type ExportPaths } from "../file-format-shared";
import { parse_markdown_v2_document, restore_markdown_v2_resources } from "./md-v2-document";

type MarkdownV2ItemMetadata = {
  before: string; // Item 前方原始 Markdown 布局
  after: string; // 文档末 Item 后方原始 Markdown 布局
};

/**
 * 当前 Markdown 格式以 AST 块为持久和写回单元，资源只在格式边界投影与恢复。
 */
export class MDV2Format {
  /** 把 Markdown AST 块转换为通用 Item，并只持久化重建布局需要的 metadata。 */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const document = parse_markdown_v2_document(await decode_text_content(content));
    return document.units.map((unit) =>
      Item.from_json({
        src: unit.src,
        dst: "",
        row: unit.start_line,
        file_type: "MD_V2",
        file_path: rel_path,
        text_type: "MD",
        status: unit.excluded ? "EXCLUDED" : "NONE",
        extra_field: {
          markdown: {
            before: unit.before,
            after: unit.after,
          },
        },
      }),
    );
  }

  /** 按块起始行恢复原布局，并从项目 asset 恢复仍合法的资源 destination。 */
  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, file_items] of group_items(items, "MD_V2")) {
      const resources = await this.read_resources(rel_path, asset_reader);
      const content = [...file_items]
        .sort((left, right) => left.row - right.row || (left.id ?? 0) - (right.id ?? 0))
        .map((item) => {
          const metadata = this.read_metadata(item);
          return (
            metadata.before +
            restore_markdown_v2_resources(item.effective_dst(), resources) +
            metadata.after
          );
        })
        .join("");
      await write_text_file(path.join(paths.translated_path, rel_path), content);
    }
  }

  /** 损坏或缺失的布局字段收窄为空串，保证现有 Item 文本仍可导出。 */
  private read_metadata(item: Item): MarkdownV2ItemMetadata {
    const markdown = read_json_record(read_json_record(item.extra_field)["markdown"]);
    return {
      before: typeof markdown["before"] === "string" ? markdown["before"] : "",
      after: typeof markdown["after"] === "string" ? markdown["after"] : "",
    };
  }

  /** 原始 asset 仅提供 token 映射；任何读取失败都保留当前译文中的 destination。 */
  private async read_resources(
    rel_path: string,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<ReadonlyMap<string, string>> {
    try {
      const content = asset_reader(rel_path);
      if (content === null) {
        return new Map();
      }
      return parse_markdown_v2_document(await decode_text_content(content)).resources;
    } catch {
      // 原始 asset 只服务资源恢复；缺失或无法解析时仍按当前译文宽松导出。
      return new Map();
    }
  }
}
