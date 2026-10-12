import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { discover_rgss_source, RGSS_VERSIONS, script_path } from "./source";
import { extract_rgss_member, read_rgss_archive, type RGSSArchiveMember } from "./archive";

const STAGING_PREFIX = ".linguagacha-rgss-";
/** 来源目录的唯一写入口，调用者必须持有工程写入占用直到恢复和清理结束。 */
export async function prepare_rgss_source(source: string, fs: NativeFs): Promise<void> {
  const game = discover_rgss_source(source, fs);
  if (!game) throw new Error("Missing RGSS game configuration");
  if (game.problem) throw new Error(game.problem);
  if (!game.archive) return;
  const { root, version, archive } = game;
  let backup: string | null = null;
  let staging: string | null = null;
  let archive_removed = false; // 清理失败时从备份恢复已移除的归档。
  const changed: string[] = []; // 仅记录进入提交阶段的成员，按逆序恢复。
  const created_directories: string[] = []; // 回滚只移除本次创建的空目录。
  try {
    assert_regular_path(root, fs);
    assert_regular_path(path.join(root, archive), fs);
    const handle = await fs.open_file(path.join(root, archive), "r");
    let members: RGSSArchiveMember[];
    try {
      members = await read_rgss_archive(handle);
      for (const member of members) {
        const first = member.name.split("/")[0]!.toLowerCase();
        if (
          /^backup(?:_\d+)?$/u.test(first) ||
          first.startsWith(STAGING_PREFIX) ||
          member.name.toLowerCase() === archive.toLowerCase()
        )
          throw new Error("RGSS member conflicts with preparation files: " + member.name);
        if (
          /^data\/.*\.(?:rxdata|rvdata2?)$/iu.test(member.name) &&
          path.extname(member.name).toLowerCase() !== RGSS_VERSIONS[version]
        )
          throw new Error("Mixed RGSS data versions: " + member.name);
        assert_regular_path(path.join(root, member.name), fs);
        if (
          fs.exists(path.join(root, member.name)) &&
          !fs.stat(path.join(root, member.name)).isFile()
        )
          throw new Error("RGSS member conflicts with a directory: " + member.name);
      }
      const scripts = script_path(fs.read_file(path.join(root, "Game.ini")), version);
      // 先收集完整备份范围，再创建目录，避免递归收集本次备份。
      const backup_files = new Set<string>([archive, "Game.ini"]);
      collect_existing_files(root, "Data", backup_files, fs);
      collect_existing_files(root, scripts, backup_files, fs);
      for (const member of members)
        if (fs.exists(path.join(root, member.name))) backup_files.add(member.name);
      backup = await create_backup_directory(root, fs);
      const data = path.join(root, "Data");
      if (fs.exists(data)) fs.copy_entry(data, path.join(backup, "Data")); // 完整保留 Data，包括空目录。
      for (const name of backup_files) {
        assert_regular_path(path.join(root, name), fs);
        if (!fs.exists(path.join(backup, name)))
          fs.copy_file(path.join(root, name), path.join(backup, name));
      }
      const directory = path.join(root, STAGING_PREFIX + randomUUID());
      await fs.make_dir_exclusive(directory);
      staging = directory;
      for (const member of members)
        await extract_rgss_member(handle, member, path.join(staging, member.name), fs);
    } finally {
      await handle.close();
    }

    for (const member of members) {
      const destination = path.join(root, member.name);
      assert_regular_path(destination, fs);
      const missing: string[] = [];
      for (
        let directory = path.dirname(destination);
        !fs.exists(directory);
        directory = path.dirname(directory)
      )
        missing.push(directory);
      for (const directory of missing.reverse()) {
        await fs.make_dir_exclusive(directory);
        created_directories.push(directory);
      }
      changed.push(member.name); // 写入失败也必须恢复该目标。
      fs.copy_file_atomic(path.join(staging!, member.name), destination);
    }
    fs.unlink(path.join(root, archive)); // 全部成员提交成功后才停用归档。
    archive_removed = true;
    if (staging) {
      await fs.remove_async(staging, { recursive: true });
      staging = null;
    }
  } catch (cause) {
    const recovery_errors: string[] = [];
    if (archive_removed) {
      try {
        fs.copy_file_atomic(path.join(backup!, archive), path.join(root, archive));
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    for (const name of changed.reverse()) {
      try {
        assert_regular_path(path.join(root, name), fs);
        if (fs.exists(path.join(backup!, name)))
          fs.copy_file_atomic(path.join(backup!, name), path.join(root, name));
        else fs.unlink(path.join(root, name), { force: true });
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    for (const directory of created_directories.reverse()) {
      try {
        fs.remove_empty_dir(directory);
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    if (recovery_errors.length === 0 && staging) {
      try {
        await fs.remove_async(staging, { recursive: true });
        staging = null;
      } catch (error) {
        recovery_errors.push(read_error_message(error));
      }
    }
    throw new AppError("file.io_failed", {
      cause,
      message: [
        read_error_message(cause),
        backup ? "Backup: " + backup : "",
        recovery_errors.length
          ? "Recovery or cleanup failed: " + recovery_errors.join("; ")
          : "Original game files retained or restored.",
        staging ? "Staging: " + staging : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

/** 包括祖先目录在内拒绝链接和文件占用，检查也能捕获悬空链接。 */
function assert_regular_path(target: string, fs: NativeFs): void {
  const parent = path.dirname(target);
  if (parent === target) return; // 卷根没有可替换的游戏目录项。
  assert_regular_path(parent, fs);
  try {
    const stat = fs.lstat(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error("Unsafe RGSS filesystem path: " + target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return; // 新成员尚未落盘。
    throw error;
  }
}
/** 备份前展开目录并拒绝链接，避免递归复制越过游戏根目录。 */
function collect_existing_files(
  root: string,
  name: string,
  files: Set<string>,
  fs: NativeFs,
): void {
  const target = path.join(root, name);
  assert_regular_path(target, fs);
  if (!fs.exists(target)) return;
  if (fs.stat(target).isFile()) {
    files.add(name);
    return;
  }
  for (const entry of fs.read_dirents(target))
    collect_existing_files(root, name + "/" + entry.name, files, fs);
}
/** 独占创建备份目录，已有路径仅影响本次名称。 */
async function create_backup_directory(root: string, fs: NativeFs): Promise<string> {
  for (let index = 1; ; index++) {
    const directory = path.join(root, index === 1 ? "backup" : "backup_" + index);
    try {
      await fs.make_dir_exclusive(directory);
      return directory;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue; // 独占创建解决已有备份的退让。
      throw error;
    }
  }
}
