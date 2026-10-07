import path from "node:path";

import { default_native_fs as native_fs } from "../../../native/native-fs";
import { AppError } from "../../../shared/error";
import { t_main_log } from "../../log/log-text";
import type { StartupMigrationContext } from "../migration-types";

// 历史布局只由本迁移识别，运行期路径统一由 AppPathService 提供。
const LEGACY_SKILL_PATH = ["agent", "skill"] as const;

/**
 * 迁移背景：
 * 旧用户技能位于 `userdata/agent/skill`，当前入口为 `userdata/skills`。
 *
 * 生效场景：
 * 启动时仅在新入口不存在且旧入口为可用目录时搬迁。相对链接转绝对目标，新入口存在即跳过。
 *
 * 不处理范围：
 * 保留已有新入口及旧残留，包括失效链接。检查时缺失静默跳过，搬迁失败记录警告后允许重试。
 */
export function user_skills_layout_migration({
  paths,
  log_manager,
}: StartupMigrationContext): void {
  const source = paths.get_user_data_path(...LEGACY_SKILL_PATH);
  const destination = paths.get_agent_user_skill_dir();
  try {
    // 入口存在即保留，包括失效链接。运行期只消费当前入口。
    if (read_entry(destination, "lstat")) return;
    const source_stat = read_entry(source, "stat"); // 跟随旧链接，目标缺失等同没有可迁移目录。
    if (!source_stat) return;
    if (!source_stat.isDirectory()) {
      throw new AppError("file.invalid_structure");
    }
    if (native_fs.lstat(source).isSymbolicLink() && !path.isAbsolute(native_fs.read_link(source))) {
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
}

/** 检查阶段的入口或链接目标缺失可跳过。搬迁阶段的错误由调用方记录。 */
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
