import path from "node:path";
import { default_native_fs } from "./native-fs";

/** 私有入口按运行目录定位，缺失意味着应用安装损坏，不能用用户依赖替代。 */
export function resolve_workspace_runtime_entry(
  directory: string,
  entry: "bootstrap" | "prepare" | "pdf-worker",
): string {
  const file = path.resolve(directory, "runtime", `${entry}.mjs`);
  try {
    default_native_fs.stat(file);
  } catch (cause) {
    throw new Error(`Application installation is damaged: cannot access '${file}'.`, { cause });
  }
  return file;
}
