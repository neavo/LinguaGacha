import path from "node:path";
import { deploy_packaged_tools, resolve_builder_arch } from "./native-tools.mjs";

/** electron-builder 拥有目标信息，这里只将其交给原生工具部署入口。 */
export default async function after_pack(context) {
  await deploy_packaged_tools({
    root: context.packager.projectDir,
    appDirectory: context.appOutDir,
    workspaceDirectory: path.join(context.packager.getResourcesDir(context.appOutDir), "workspace"),
    platform: context.electronPlatformName,
    arch: resolve_builder_arch(context.arch),
  });
}
