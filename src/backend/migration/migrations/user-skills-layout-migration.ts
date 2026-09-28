import path from "node:path";

import { default_native_fs as native_fs } from "../../../native/native-fs";
import { AppError } from "../../../shared/error";
import { t_main_log } from "../../log/log-text";
import type { MigrationDescriptor } from "../migration-types";

// 历史布局只由本迁移识别，运行期路径统一由 AppPathService 提供。
const LEGACY_SKILL_PATH = ["agent", "skill"] as const;

/** 将旧用户技能入口整体迁入当前数据目录。 */
export const user_skills_layout_migration: MigrationDescriptor = {
  id: "user-skills-layout",
  order: 400,
  /** 当前入口优先；历史技能搬迁失败只记录警告，让应用继续启动。 */
  run_startup({ paths, log_manager }): void {
    const source = paths.get_user_data_path(...LEGACY_SKILL_PATH);
    const destination = paths.get_agent_user_skill_dir();
    try {
      // 入口存在即保留，包括失效链接；运行期只消费当前入口。
      if (read_entry(destination, "lstat")) return;
      const source_stat = read_entry(source, "stat"); // 跟随旧链接，目标缺失等同没有可迁移目录。
      if (!source_stat) return;
      if (!source_stat.isDirectory()) {
        throw new AppError("file.invalid_structure");
      }
      if (
        native_fs.lstat(source).isSymbolicLink() &&
        !path.isAbsolute(native_fs.read_link(source))
      ) {
        // 上移一层会改变相对目标含义。先建立绝对链接，再移除旧入口。
        native_fs.create_directory_link(native_fs.real_path(source), destination);
        native_fs.unlink(source);
      } else {
        native_fs.rename(source, destination);
      }
    } catch (error) {
      log_manager.warning(
        t_main_log("app.diagnostic.migration.path_failed", {
          SOURCE_PATH: source,
          DESTINATION_PATH: destination,
        }),
        { source: "migration", error },
      );
    }
  },
};

/** 检查阶段的入口或链接目标缺失可跳过；搬迁阶段的错误由调用方记录。 */
function read_entry(
  target: string,
  method: "stat" | "lstat",
): ReturnType<typeof native_fs.stat> | undefined {
  try {
    return native_fs[method](target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
