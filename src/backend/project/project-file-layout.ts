import { AppError } from "../../shared/error";
import {
  assert_source_file_paths,
  normalize_project_asset_path,
  project_asset_extension,
} from "../../shared/project/project-asset-paths";
import { is_portable_file_name } from "../../shared/utils/file-name";
import { insert_by_sort } from "./insert-by-sort";

/** 更新只调整资产身份与位置，内容变化通过独立替换操作完成。 */
export type ProjectFileUpdate = {
  file_path: string;
  new_file_path?: string;
  sort?: number;
  line: number; // 同一插入位置按原始记录行号排序。
};

/** 预演、来源命名与事务共用布局，禁止依赖执行顺序的交换和链式改名。 */
export function resolve_project_file_layout(
  current: readonly { path: string; file_type: string }[],
  deletes: readonly string[],
  updates: readonly ProjectFileUpdate[],
): { path: string; previous_path: string; file_type: string }[] {
  const deleted = new Set(deletes);
  const targets = [...deletes, ...updates.map((update) => update.file_path)];
  if (
    new Set(targets).size !== targets.length ||
    targets.some((target) => !current.some((file) => file.path === target))
  )
    throw new AppError("request.validation_failed");
  const remaining = current.filter((file) => !deleted.has(file.path));
  const layout = remaining.map((file) => {
    const update = updates.find((entry) => entry.file_path === file.path);
    const target =
      update?.new_file_path === undefined
        ? file.path
        : normalize_project_asset_path(update.new_file_path);
    // 扩展名决定格式与游戏输出目录。未改名的已有路径按磁盘事实保留。
    if (target !== file.path) {
      if (project_asset_extension(target) !== project_asset_extension(file.path))
        throw new AppError("request.validation_failed", {
          message: `Renaming "${file.path}" to "${target}" would change the file extension.`,
          public_details: { file_path: file.path },
        });
      if (!target.split("/").every(is_portable_file_name))
        throw new AppError("request.validation_failed", {
          message: `Invalid file name in "${target}": names must not contain reserved characters, end with a dot or space, or use a reserved device name.`,
          public_details: { file_path: file.path },
        });
      // 最终集合校验无法发现交换和链式改名，目标还须避开当前占用。
      if (
        remaining.some(
          (other) =>
            other.path !== file.path &&
            normalize_project_asset_path(other.path).toLowerCase() === target.toLowerCase(),
        )
      )
        throw new AppError("request.validation_failed", {
          message: `"${target}" conflicts with an existing file or directory at "${target}".`,
          public_details: { file_path: file.path, conflict: target },
        });
    }
    if (update?.sort !== undefined && (!Number.isInteger(update.sort) || update.sort < -1))
      throw new AppError("request.validation_failed");
    return { path: target, previous_path: file.path, file_type: file.file_type };
  });
  assert_source_file_paths(layout);
  const sorted = updates.flatMap((update) =>
    update.sort === undefined
      ? []
      : [
          {
            value: layout.find((file) => file.previous_path === update.file_path)!,
            sort: update.sort,
            rank: 0,
            line: update.line,
          },
        ],
  );
  return insert_by_sort(
    layout.filter((file) => !sorted.some((entry) => entry.value === file)),
    sorted,
  );
}
