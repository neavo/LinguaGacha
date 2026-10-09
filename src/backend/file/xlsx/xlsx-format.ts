import path from "node:path";
import { read_translation_for_generation } from "../translation-generation-text";
import { type Item, create_item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { group_items, write_binary_file, type GeneratedFilePaths } from "../file-format-shared";
import { read_workbook, cell_text, write_cell } from "../spreadsheet";

const WOLF_HEADER = ["code", "flag", "type", "info"];
const WOLF_SOURCE_COLUMN = 6;
const WOLF_TARGET_COLUMN = 7;
const WOLF_TRANSLATABLE_FILL = 9;

/** 同一工作簿只打开一次，首表的表头决定普通双列或 WOLF 的读取方式。 */
export class XLSXFormat {
  /** 按首表列语义提取条目，并保留原行号与翻译状态。 */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const workbook = await read_workbook(content);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const wolf = WOLF_HEADER.every((label, index) =>
      cell_text(sheet.getCell(1, index + 1).value)
        .toLowerCase()
        .includes(label),
    );
    const items: Item[] = [];
    for (let row = wolf ? 2 : 1; row <= sheet.rowCount; row++) {
      const source = sheet.getCell(row, wolf ? WOLF_SOURCE_COLUMN : 1);
      if (source.value === null || source.value === undefined) continue;
      const src = cell_text(source.value);
      const dst = cell_text(sheet.getCell(row, wolf ? WOLF_TARGET_COLUMN : 2).value);
      const fill = source.fill;
      const allowed =
        !wolf ||
        (fill?.type === "pattern" &&
          fill.fgColor !== undefined &&
          "indexed" in fill.fgColor &&
          fill.fgColor.indexed === WOLF_TRANSLATABLE_FILL);
      items.push(
        create_item({
          src,
          dst,
          row,
          file_path: rel_path,
          file_type: wolf ? "WOLFXLSX" : "XLSX",
          ...(wolf ? { text_type: "WOLF" } : {}),
          status:
            src === "" || !allowed
              ? "RULE_SKIPPED"
              : dst !== "" && src !== dst
                ? "PROCESSED"
                : "NONE",
        }),
      );
    }
    return items;
  }

  /** 普通表与 WOLF 共用源工作簿写回，仅覆盖已完成条目的译文。 */
  public async write_to_path(
    items: Item[],
    paths: GeneratedFilePaths,
    asset_reader: (path: string) => Buffer | null,
  ): Promise<void> {
    for (const type of ["XLSX", "WOLFXLSX"] as const)
      for (const [rel_path, group] of group_items(items, type)) {
        const wolf = type === "WOLFXLSX";
        // KV 类：两个格式都从源工作簿写回，未完成条目保留目标单元格及其原始值和格式。
        const original = asset_reader(rel_path);
        if (original === null)
          throw new AppError("file.not_found", { public_details: { file: rel_path } });
        const workbook = await read_workbook(original);
        const sheet = workbook.worksheets[0];
        if (!sheet)
          throw new AppError("file.invalid_structure", { public_details: { file: rel_path } });
        for (const item of group) {
          const translation = read_translation_for_generation(item);
          if (translation !== undefined) {
            write_cell(sheet, item.row, wolf ? WOLF_TARGET_COLUMN : 2, translation);
          }
        }
        await write_binary_file(
          path.join(paths.translated_path, rel_path),
          await workbook.xlsx.writeBuffer(),
        );
      }
  }
}
