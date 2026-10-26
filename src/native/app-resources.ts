import path from "node:path";

/** GUI 与 CLI 共用真实资源位置，后端只消费入口注入的路径。 */
export function resolve_app_resources(args: {
  packaged: boolean;
  resourcesPath: string;
  projectRoot: string;
}): {
  builtinRoot: string; // 后端读取的版本内置资产
  fontsDirectory: string; // 界面与 PDF 共用的字体
  stylesPath: string; // PDF 打印样式
} {
  return {
    builtinRoot: path.join(args.packaged ? args.resourcesPath : args.projectRoot, "builtin"),
    fontsDirectory: path.join(
      args.packaged ? args.resourcesPath : path.join(args.projectRoot, "public"),
      "fonts",
    ),
    stylesPath: path.join(
      args.packaged ? args.resourcesPath : path.join(args.projectRoot, "build/resources"),
      "pdf-print.css",
    ),
  };
}
