import path from "node:path";

import { default_native_fs } from "../../../native/native-fs";
import { PathRelocation } from "../path-relocation";
import type { MigrationDescriptor, StartupMigrationContext } from "../migration-types";

// 旧提示词预设目录名固定，迁移只把 zh/en 下的 .txt 用户预设合并到当前 userdata。
const RESOURCE_DIR_NAME = "resource";
const PRESET_DIR_NAME = "preset";
const CUSTOM_PROMPT_DIR_NAME = "custom_prompt";
const USER_DIR_NAME = "user";
const LANGUAGE_DIR_NAMES = ["zh", "en"] as const;
const PROMPT_PRESET_EXTENSION = ".txt";

/**
 * 迁移背景：
 * 旧翻译提示词用户预设位于 `resource/preset/custom_prompt/user/<lang>`。
 * 当前提示词用户预设统一落在 `userdata/translation_prompt`，不再按界面语言拆目录。
 *
 * 生效场景：
 * Backend 启动、设置服务读取前，把旧中英文用户预设合并迁到当前用户目录。
 *
 * 不处理范围：
 * 只迁移 `.txt` 预设文件；目标同名文件代表当前用户事实，保留目标并清理旧源。
 */
export const prompt_user_preset_layout_migration: MigrationDescriptor = {
  id: "prompt-user-preset-layout",
  order: 200,
  /**
   * 启动期先创建当前目录，再从旧语言目录迁入 `.txt` 用户预设。
   */
  run_startup(context: StartupMigrationContext): void {
    const relocation = new PathRelocation(context.log_manager);
    const destination_dir = context.paths.get_prompt_user_preset_dir("translation");
    default_native_fs.make_dir(destination_dir);
    for (const source_dir of get_legacy_prompt_user_preset_dirs(context)) {
      relocation.relocate_directory_items(source_dir, destination_dir, PROMPT_PRESET_EXTENSION, [
        context.paths.get_app_root(),
        context.paths.get_data_root(),
      ]);
    }
  },
};

/**
 * 旧提示词用户预设只出现过 zh/en 两层；当前目录不再保留语言层。
 */
function get_legacy_prompt_user_preset_dirs(context: StartupMigrationContext): string[] {
  return LANGUAGE_DIR_NAMES.map((language) =>
    path.join(
      context.paths.get_app_root(),
      RESOURCE_DIR_NAME,
      PRESET_DIR_NAME,
      CUSTOM_PROMPT_DIR_NAME,
      USER_DIR_NAME,
      language,
    ),
  );
}
