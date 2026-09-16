import { createRequire } from "node:module";
import path from "node:path";

/** 开发和发行入口共用运行目录定位，Backend 只消费宿主注入的目录。 */
export function resolve_workspace_runtime_directory(args: {
  packaged: boolean;
  resourcesPath: string;
  projectRoot: string;
}): string {
  const resources = args.packaged
    ? args.resourcesPath
    : path.join(args.projectRoot, "build", "resources");
  return path.join(resources, "workspace");
}

/** 只解析包导出，bootstrap 和 worker 的初始化由对应执行进程负责。 */
export function resolve_workspace_runtime_entry(
  directory: string,
  entry: "@lg/workspace/bootstrap" | "@lg/pdf" | "@lg/pdf/worker",
): string {
  return createRequire(path.join(path.resolve(directory), "package.json")).resolve(entry);
}
