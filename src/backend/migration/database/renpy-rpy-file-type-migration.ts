import type { DatabaseSync } from "node:sqlite";
import { is_json_record } from "../../../domain/json";
import { write_item_migration } from "./item-migration";

/**
 * 迁移背景：
 * 已发布的 `.rpy` 格式使用 `RENPY` 和 `extra_field.renpy`。
 * 原生游戏接管这两个名称，旧格式改用 `RENPY_RPY` 和 `extra_field.renpy_rpy`。
 *
 * 生效场景：
 * 打开旧工程时，在 `asset-file-type` 迁移完成后执行一次。
 * 新工程在写入资产前已完成迁移，因此原生游戏资产保留 `RENPY` 身份。
 *
 * 不处理范围：
 * 历史字符串 `extra_field` 保留原值，由 `.rpy` 写回兼容入口恢复译文。
 */
export function run_renpy_rpy_file_type_migration(db: DatabaseSync): void {
  // 改名后无法再查询旧类型，先保存路径以限定条目迁移范围。
  const paths = new Set(
    db
      .prepare("SELECT path FROM assets WHERE file_type = 'RENPY'")
      .all()
      .map((row) => String(row["path"])),
  );
  db.prepare("UPDATE assets SET file_type = 'RENPY_RPY' WHERE file_type = 'RENPY'").run();
  write_item_migration(db, (item) => {
    const extra = item["extra_field"];
    if (!paths.has(String(item["file_path"])) || !is_json_record(extra) || !("renpy" in extra))
      return { data: item, changed: false };
    const { renpy, ...rest } = extra;
    return { data: { ...item, extra_field: { ...rest, renpy_rpy: renpy } }, changed: true };
  });
}
