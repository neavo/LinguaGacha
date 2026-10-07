import { is_json_record, type JsonRecord } from "../../../domain/json";
import { MODEL_USAGES, normalize_model_selection } from "../../../domain/model";
import { default_native_fs } from "../../../native/native-fs";
import { JsonTool } from "../../../shared/utils/json-tool";
import type { StartupMigrationContext } from "../migration-types";

const LEGACY_ACTIVE_MODEL_ID_KEY = "activate_model_id";

/**
 * 迁移背景：
 * 旧配置只有 `activate_model_id`。当前按 translation、agent 用途保存模型选择。
 *
 * 生效场景：
 * 设置服务首次读取前，旧字段存在时仅补空用途并删除旧字段。已有用途选择保留，重复启动为空操作。
 *
 * 不处理范围：
 * 不验证模型可用性，不改其它配置。解析或写入错误继续交给启动入口处理。
 */
export function model_selection_migration(context: StartupMigrationContext): void {
  const config_path = context.paths.get_config_path();
  if (!default_native_fs.exists(config_path) || !default_native_fs.stat(config_path).isFile()) {
    return;
  }
  const setting_data = JsonTool.parseStrict<unknown>(default_native_fs.read_file(config_path));
  if (!is_json_record(setting_data) || !Object.hasOwn(setting_data, LEGACY_ACTIVE_MODEL_ID_KEY)) {
    return;
  }

  const legacy_model_id = String(setting_data[LEGACY_ACTIVE_MODEL_ID_KEY] ?? "").trim();
  const selection = normalize_model_selection(setting_data["model_selection"]);
  for (const usage of MODEL_USAGES) {
    if (selection[usage] === "") {
      selection[usage] = legacy_model_id;
    }
  }

  const migrated_setting: JsonRecord = { ...setting_data, model_selection: selection };
  delete migrated_setting[LEGACY_ACTIVE_MODEL_ID_KEY];
  default_native_fs.write_file_sync(
    config_path,
    JsonTool.stringifyStrict(migrated_setting, { indent: 4 }),
  );
}
