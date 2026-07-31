import { is_json_record, type JsonRecord } from "../../../domain/json";
import { MODEL_USAGES, normalize_model_selection } from "../../../domain/model";
import { default_native_fs } from "../../../native/native-fs";
import { JsonTool } from "../../../shared/utils/json-tool";
import type { MigrationDescriptor, StartupMigrationContext } from "../migration-types";

const LEGACY_ACTIVE_MODEL_ID_KEY = "activate_model_id";

/**
 * 迁移背景：旧配置只保存一个激活模型，当前配置按 translation、analysis、agent
 * 三种用途分别保存选择。迁移必须在 AppSettingService 首次归一配置前读取旧字段。
 */
export const model_selection_migration: MigrationDescriptor = {
  id: "model-selection",
  order: 400,
  run_startup(context: StartupMigrationContext): void {
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
  },
};
