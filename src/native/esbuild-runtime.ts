import path from "node:path";

/** 产品入口先配置物理二进制路径，再加载 SDK；后续 worker 继承相同环境。 */
export function configure_packaged_esbuild(desktop_bundle_dir: string): void {
  // 发行布局固定为 `app.asar/build/dist-electron`；开发态沿用 npm 与开发者的环境设置。
  const archive = path.resolve(desktop_bundle_dir, "../..");
  if (path.basename(archive) !== "app.asar") return;
  // `esbuild` 在模块加载时读取此变量；`spawn` 无法使用 ASAR 的虚拟文件路径。
  process.env.ESBUILD_BINARY_PATH = path.join(
    `${archive}.unpacked`,
    "node_modules",
    "@esbuild",
    `${process.platform}-${process.arch}`,
    process.platform === "win32" ? "esbuild.exe" : "bin/esbuild",
  );
}
