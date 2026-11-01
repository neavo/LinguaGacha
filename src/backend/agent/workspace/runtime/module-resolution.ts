import { createRequire, findPackageJSON, isBuiltin, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 应用保留 @lg 命名空间，工作材料与技能的第三方包归用户工程，包内依赖沿用 Node 解析。 */
export function install_workspace_module_resolution(
  runtime_directory: string,
  shared_root: string,
  roots: readonly string[],
): void {
  const application = pathToFileURL(path.join(runtime_directory, "package.json")).href;
  const shared = pathToFileURL(path.join(shared_root, "package.json")).href;
  const application_require = createRequire(application);
  const shared_require = createRequire(shared);
  registerHooks({
    /** 按包归属选择安装根，包内依赖继续使用 Node 原生解析。 */
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      const from_workspace =
        parent !== undefined &&
        roots.some((root) => parent.startsWith(root)) &&
        !new URL(parent).pathname.includes("/node_modules/");
      const bare =
        !isBuiltin(specifier) &&
        !specifier.startsWith(".") &&
        !path.isAbsolute(specifier) &&
        !specifier.startsWith("#") &&
        !URL.canParse(specifier);
      if (!bare) return nextResolve(specifier, context);
      const sdk = specifier.startsWith("@lg/");
      if (!sdk && !from_workspace) return nextResolve(specifier, context);
      const base = sdk ? application : shared;
      // createRequire.resolve 会重入同步钩子。锚点自身交给 Node，避免递归。
      if (parent === base) return nextResolve(specifier, context);
      const root = sdk ? runtime_directory : shared_root;
      const require = sdk ? application_require : shared_require;
      const commonjs = context.conditions.includes("require");
      const resolved = commonjs
        ? { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true }
        : nextResolve(specifier, { ...context, parentURL: base });
      // Node 会继续搜索祖先目录，只接受所选安装根中的包，防止漏装时误用开发依赖。
      const name = specifier
        .split("/")
        .slice(0, specifier.startsWith("@") ? 2 : 1)
        .join("/");
      const manifest = findPackageJSON(specifier, base);
      const expected = path.join(root, "node_modules", name, "package.json");
      if (manifest === undefined || path.relative(expected, manifest) !== "")
        throw Object.assign(new Error(`Cannot find package '${name}' in '${root}'.`), {
          code: commonjs ? "MODULE_NOT_FOUND" : "ERR_MODULE_NOT_FOUND",
        });
      return resolved;
    },
  });
}
