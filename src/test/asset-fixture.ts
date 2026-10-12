import fs from "node:fs";
import path from "node:path";
import type { ProjectDatabaseAccess } from "../backend/database/database-operations";
import type { PDFDocument } from "../shared/pdf";

/** 测试夹具按已知文件名提供身份，内容识别由格式行为测试覆盖。 */
export function fixture_file_type(file: string): string {
  return (
    (
      {
        ".txt": "TXT",
        ".md": "MD_V2",
        ".epub": "EPUB",
        ".trans": "TRANS",
        ".xlsx": "XLSX",
        ".json": "KVJSON",
        ".pdf": "PDF",
        ".rpy": "RENPY",
        ".ssa": "ASS",
        ".ass": "ASS",
        ".srt": "SRT",
        ".vtt": "VTT",
        ".lrc": "LRC",
      } as Record<string, string>
    )[path.extname(file).toLowerCase()] ?? "NONE"
  );
}
/** 读取测试临时文件后调用资产写入口。 */
export function add_test_asset_from_source(
  database: ProjectDatabaseAccess,
  project: string,
  file: string,
  source: string,
  document: PDFDocument | null,
  order: number | null = null,
): void {
  database.add_asset(
    project,
    file,
    fs.readFileSync(source),
    fixture_file_type(file),
    document,
    order,
  );
}
/** 测试显式替换原稿，用于验证资产和 PDF 摘要的事务一致性。 */
export function update_test_asset_from_source(
  database: ProjectDatabaseAccess,
  project: string,
  file: string,
  source: string,
  document: PDFDocument | null,
): void {
  database.update_asset(project, file, fs.readFileSync(source), fixture_file_type(file), document);
}
