import { is_json_record } from "../../../domain/json";
import type { DatabaseSync } from "node:sqlite";
import { normalize_migration_file_type, write_item_migration } from "./item-migration";

/** 文件身份移交资产后删除条目副本；损坏 JSON 沿用历史保留策略。 */
export function run_asset_file_type_migration(db: DatabaseSync): void {
  const rows = db.prepare("SELECT data FROM items WHERE json_valid(data) ORDER BY id").iterate();
  const types = new Map<string, string>();
  for (const row of rows) {
    const item = JSON.parse(String(row["data"]));
    if (!is_json_record(item)) continue;
    const type = normalize_migration_file_type(item.file_type);
    if (type !== "NONE" && !types.has(String(item.file_path ?? "")))
      types.set(String(item.file_path ?? ""), type);
  }
  const pdf = new Set(
    db
      .prepare("SELECT file_path FROM pdf_documents")
      .all()
      .map((row) => String(row["file_path"])),
  );
  const extensions: Record<string, string> = {
    // 固定历史格式口径，后续新增解析器不改变旧工程迁移。
    txt: "TXT",
    md: "MD_V2",
    ass: "ASS",
    ssa: "ASS",
    srt: "SRT",
    vtt: "VTT",
    lrc: "LRC",
    epub: "EPUB",
    rpy: "RENPY",
    trans: "TRANS",
    pdf: "PDF",
  };
  const update = db.prepare("UPDATE assets SET file_type = ? WHERE path = ?");
  for (const row of db.prepare("SELECT path FROM assets").all()) {
    const path = String(row["path"]);
    update.run(
      pdf.has(path)
        ? "PDF"
        : (types.get(path) ?? extensions[path.split(".").at(-1)!.toLowerCase()] ?? "NONE"),
      path,
    );
  }
  write_item_migration(db, (item) => {
    const data = { ...item };
    delete data["file_type"];
    delete data["text_type"];
    return { data, changed: "file_type" in item || "text_type" in item };
  });
}
