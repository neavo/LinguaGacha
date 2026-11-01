import path from "node:path";
import { deploy_packaged_tools, resolve_builder_arch } from "./native-tools.mjs";
import { remove_license_files } from "../resources/license-files.mjs";

/** 按目标平台部署工具，并在归档前清理 Electron 发行目录带入的许可文本。 */
export default async function after_pack(context) {
  await deploy_packaged_tools({
    root: context.packager.projectDir,
    appDirectory: context.appOutDir,
    workspaceDirectory: path.join(context.packager.getResourcesDir(context.appOutDir), "workspace"),
    platform: context.electronPlatformName,
    arch: resolve_builder_arch(context.arch),
  });
  await remove_license_files(context.appOutDir);
}
