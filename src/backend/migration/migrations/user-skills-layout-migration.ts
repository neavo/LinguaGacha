import path from "node:path";

import { default_native_fs as native_fs } from "../../../native/native-fs";
import { AppError } from "../../../shared/error";
import type { MigrationDescriptor } from "../migration-types";

// 历史布局只由本迁移识别，运行期路径统一由 AppPathService 提供。
const LEGACY_SKILL_PATH = ["agent", "skill"] as const;

/** 将旧用户技能入口整体迁入当前数据目录。 */
export const user_skills_layout_migration: MigrationDescriptor = {
  id: "user-skills-layout",
  order: 400,
  /** 迁移失败时中止启动，避免运行器创建新目录后形成两份用户技能。 */
  run_startup({ paths }): void {
    const source = paths.get_user_data_path(...LEGACY_SKILL_PATH);
    const destination = paths.get_agent_user_skill_dir();
    try {
      const source_entry = read_entry(source);
      if (!source_entry) return;
      if (!native_fs.stat(source).isDirectory()) {
        throw new AppError("file.invalid_structure");
      }
      const destination_entry = read_entry(destination);
      if (destination_entry) {
        // 新入口创建后可能中断。只有直接指向原目标的链接才能脱离旧入口继续使用。
        if (
          source_entry.isSymbolicLink() &&
          destination_entry.isSymbolicLink() &&
          native_fs.to_identity_path(native_fs.real_path(source)) ===
            native_fs.to_identity_path(
              path.resolve(path.dirname(destination), native_fs.read_link(destination)),
            )
        ) {
          native_fs.unlink(source);
          return;
        }
        throw new AppError("file.already_exists");
      }
      if (source_entry.isSymbolicLink() && !path.isAbsolute(native_fs.read_link(source))) {
        // 上移一层会改变相对目标含义。先建立绝对链接，再移除旧入口。
        native_fs.create_directory_link(native_fs.real_path(source), destination);
        native_fs.unlink(source);
      } else {
        native_fs.rename(source, destination);
      }
    } catch (cause) {
      throw new AppError("file.io_failed", {
        cause,
        diagnostic_context: {
          reason: "user_skills_layout_migration_failed",
          source,
          destination,
        },
      });
    }
  },
};

/** 入口缺失时返回 undefined，其它文件系统错误交给调用方处理。 */
function read_entry(target: string): ReturnType<typeof native_fs.lstat> | undefined {
  try {
    return native_fs.lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
