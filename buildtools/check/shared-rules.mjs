import path from "node:path";

import { is_test_file, is_typescript_source, index_source_module_paths } from "./core.mjs";

const HOST_MODULES = new Set([
  "fs",
  "sqlite",
  "child_process",
  "worker_threads",
  "cluster",
  "net",
  "http",
  "https",
  "tls",
  "dgram",
  "electron",
  "react",
  "react-dom",
]);
const APPLICATION_LAYERS = new Set(["backend", "frontend", "gui", "native", "cli", "test"]);

/** 基础层约束真实宿主依赖；纯计算、协议类型和可移植标准 API 可继续共享。 */
export function create_shared_boundary_rules() {
  return [
    {
      name: "基础层依赖",
      /** 在共享声明与实现中检查应用依赖和宿主能力。 */
      check(context) {
        const errors = [];
        for (const file of context.files.filter(
          (file) => is_typescript_source(file) && !is_test_file(file),
        )) {
          const relative_path = context.relative_path(file);
          if (!/^src\/(domain|shared)\//u.test(relative_path)) continue;
          for (const entry of context.read_imports(file)) {
            const target = context.resolve_import(file, entry.specifier);
            const layer = target === null ? null : context.relative_path(target).split("/")[1];
            const package_name = entry.specifier.replace(/^node:/u, "").split("/")[0];
            if (
              APPLICATION_LAYERS.has(layer) ||
              HOST_MODULES.has(package_name) ||
              (relative_path === "src/shared/pdf-schema.ts" &&
                entry.specifier.startsWith("@earendil-works/"))
            ) {
              errors.push({
                relative_path,
                line: entry.line,
                message: "基础契约只能消费纯规则与数据能力，宿主及应用实现由对应入口拥有",
              });
            }
          }
        }
        return errors;
      },
    },
    {
      name: "数据库迁移加载边界",
      /** 沿数据库迁移的运行依赖检查加载范围。 */
      check(context) {
        const source_files = index_source_module_paths(
          context.files.filter((file) => !is_test_file(file)),
        );
        const entry = path.join(
          context.project_root,
          "src/backend/migration/database-migrations.ts",
        );
        const visited = new Set();
        const errors = [];
        /** 每个模块访问一次，覆盖转发链并终止循环依赖。 */
        function visit(file) {
          if (visited.has(file)) return;
          visited.add(file);
          for (const dependency of context.read_runtime_imports(file)) {
            const target = context.resolve_import(file, dependency.specifier);
            if (target === null) continue;
            const relative_target = context.relative_path(target);
            if (
              relative_target.startsWith("src/backend/file/") ||
              relative_target.startsWith("src/backend/project/") ||
              /^src\/backend\/migration\/(startup|project)-migrations(?:\.ts)?$/u.test(
                relative_target,
              )
            ) {
              errors.push({
                relative_path: context.relative_path(file),
                line: dependency.line,
                message:
                  "数据库迁移的运行依赖只能包含存储升级能力，启动与工程打开迁移由各自入口加载",
              });
              continue;
            }
            const source = source_files.get(target);
            if (source !== undefined) visit(source);
          }
        }
        if (source_files.has(entry)) visit(entry);
        return errors;
      },
    },
  ];
}
