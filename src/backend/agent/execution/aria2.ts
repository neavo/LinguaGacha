import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";

/** 调用者持有共享执行租约，确保替换二进制时没有仍在运行的工作区进程。 */
export function prepare_aria2(runtime: string, directory: string): void {
  const source = path.join(runtime, "bin", `${process.platform}-${process.arch}`, "aria2");
  const name = process.platform === "win32" ? "aria2c.exe" : "aria2c";
  const original = path.join(source, name);
  const target = path.join(directory, name);
  const content = fs.read_file(original);
  let current: Buffer | undefined;
  try {
    current = fs.read_file(target);
  } catch (error) {
    // 缺失表示首次部署或用户删除，其余 IO 错误须保留。
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (!current?.equals(content)) fs.copy_file_atomic(original, target);
}
