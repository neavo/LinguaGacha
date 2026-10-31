import { createRequire, findPackageJSON, isBuiltin, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 只重定位工作材料与技能发起的裸包导入，包内依赖继续使用 Node 原生解析。 */
export function install_workspace_module_resolution(
  shared_root: string,
  roots: readonly string[],
): void {
  const base = pathToFileURL(path.join(shared_root, "package.json")).href;
  const require = createRequire(base);
  registerHooks({
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
      if (!from_workspace || !bare) return nextResolve(specifier, context);
      const commonjs = context.conditions.includes("require");
      const resolved = commonjs
        ? { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true }
        : nextResolve(specifier, { ...context, parentURL: base });
      // Node 会继续搜索祖先目录；只接受共享工程选中的包，条件导出和包内依赖仍由 Node 处理。
      const name = specifier
        .split("/")
        .slice(0, specifier.startsWith("@") ? 2 : 1)
        .join("/");
      const manifest = findPackageJSON(specifier, base);
      const expected = path.join(shared_root, "node_modules", name, "package.json");
      if (manifest === undefined || path.relative(expected, manifest) !== "")
        throw Object.assign(new Error(`Cannot find package '${name}' in '${shared_root}'.`), {
          code: commonjs ? "MODULE_NOT_FOUND" : "ERR_MODULE_NOT_FOUND",
        });
      return resolved;
    },
  });
}
