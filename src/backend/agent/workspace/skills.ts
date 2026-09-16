import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";

/** 复制选中的技能包，脚本只能读此副本；不把技能根的链接权限交给 Node。 */
export function project_workspace_skill(
  native_fs: NativeFs,
  workspace: string,
  name: string,
  source: string,
): string {
  if (!/^[a-z0-9-]+$/u.test(name)) throw new Error("Invalid skill name.");
  const files: { source: string; relative: string }[] = [];
  const collect = (directory: string, prefix: string): void => {
    for (const entry of native_fs.read_dirents(directory)) {
      const relative = path.join(prefix, entry.name);
      const target = path.join(directory, entry.name);
      // 包内链接可能越过授权根或形成循环；可执行投影只接受普通文件和目录。
      if (entry.isSymbolicLink()) throw new Error("Skill modules cannot contain symbolic links.");
      if (entry.isDirectory()) collect(target, relative);
      else if (entry.isFile()) files.push({ source: target, relative });
      else throw new Error("Unsupported skill resource.");
    }
  };
  collect(source, "");
  const relative = `skills/${name}`;
  const destination = path.join(workspace, relative);
  native_fs.remove(destination, { recursive: true, force: true });
  native_fs.make_dir(destination);
  try {
    for (const file of files)
      native_fs.copy_file(file.source, path.join(destination, file.relative));
  } catch (error) {
    native_fs.remove(destination, { recursive: true, force: true });
    throw error;
  }
  return relative;
}
