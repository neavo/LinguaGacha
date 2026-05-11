import path from "node:path";

import type { Item } from "../../../base/item";
import {
  build_bilingual_path,
  build_target_path,
  group_items as group_file_items,
  type ExportPaths,
  type FileFormatServiceConfig,
} from "./file-format-shared";
import { EpubAst } from "./epub-ast";
import { EpubWriter } from "./epub-writer";

/**
 * EPUB 格式门面，解析和写回都收口在 Electron main 的文件域。
 */
export class EPUBFormat {
  /**
   * AST 抽取器在读取时生成可回放定位信息，写回器会复用同一协议。
   */
  private readonly ast = new EpubAst();

  /**
   * 写回器持有格式配置，门面只负责按文件分组和目标路径分派。
   */
  private readonly writer: EpubWriter;

  /**
   * 构造时绑定文件格式配置，保证译文/双语路径和去重策略在一次导出中一致。
   */
  public constructor(private readonly config: FileFormatServiceConfig) {
    this.writer = new EpubWriter(config);
  }

  /**
   * EPUB 读取交给 AST 层处理，门面保留统一 FileFormat 接口形状。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    return this.ast.read_from_stream(content, rel_path);
  }

  /**
   * 写回时同时生成译文版和双语对照版，缺失原始 asset 时跳过该 EPUB。
   */
  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, file_items] of group_file_items(items, "EPUB")) {
      const original_content = asset_reader(rel_path);
      if (original_content === null) {
        continue;
      }
      await this.writer.build_epub(
        original_content,
        file_items,
        build_target_path(this.config, paths.translated_path, rel_path),
        false,
      );
      await this.writer.build_epub(
        original_content,
        file_items,
        build_bilingual_path(this.config, paths.bilingual_path, rel_path),
        true,
      );
    }
  }

  /**
   * 替换源文件时只替换文件名，保留 EPUB 在工程资源目录中的相对父路径。
   */
  public build_replace_target_rel_path(old_rel_path: string, new_file_path: string): string {
    const parent = path.dirname(old_rel_path);
    const new_name = path.basename(new_file_path);
    return parent === "." || parent === "" ? new_name : path.join(parent, new_name);
  }
}
